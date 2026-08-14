<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter, RouterLink } from "vue-router";
import type { ScoringSeasonSelectionStatusDTO } from "@mplus/contracts";
import { formatPercentileBpsLabel } from "@mplus/contracts";
import { ApiClientError } from "../api/live-client";
import StatusBanner from "../components/common/StatusBanner.vue";
import { formatScoringSeasonLabel } from "../lib/scoringSeasonLabel";

const props = defineProps<{ embedded?: boolean }>();

const router = useRouter();
const apiBase = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

type RecalcStatus = "QUEUED" | "ENQUEUE_FAILED" | "NO_SCORES" | null;

interface SeasonRow {
  id: string;
  slug: string;
  name: string;
  blizzardSeasonId: number | null;
}
interface ResolvedAnchor {
  percentileBps: number;
  percentileLabel: string | null;
  medianKeyThreshold: number | null;
  factor: number;
}
interface RevisionView {
  id: string;
  version: number;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  tierFactors: Record<1 | 2 | 3 | 4 | 5, number>;
  specAssignments: Array<{ classSlug: string; specSlug: string; tier: 1 | 2 | 3 | 4 | 5 }>;
  percentileAnchors: Array<{ percentileBps: number; factor: number }>;
  resolvedAnchors: ResolvedAnchor[];
  distribution: { id: string; source: string; sourceVersion: string | null; collectedAt: string } | null;
  distributionMissing: boolean;
}
interface SpecClass {
  slug: string;
  name: string;
  specs: Array<{ slug: string; name: string; role: string }>;
}
interface SeasonState {
  season: SeasonRow & { blizzardSeasonId: number | null; regionCode: string | null };
  published: RevisionView | null;
  draft: RevisionView | null;
  history: Array<{ id: string; version: number; status: string; publishedAt: string | null }>;
  distributions: Array<{ id: string; source: string; sourceVersion: string | null; collectedAt: string; pointCount: number }>;
  distributionMissing: boolean;
  canonicalSpecializations: { classes: SpecClass[]; stepBandHelp: string; tierSemantics: Record<string, string> };
}

const scoringSeason = ref<ScoringSeasonSelectionStatusDTO | null>(null);
const seasonId = ref("");
const state = ref<SeasonState | null>(null);
const error = ref<string | null>(null);
const busy = ref(false);
const recalc = ref<{ status: RecalcStatus; bulkOperationId: string | null; error: string | null; retryAvailable?: boolean } | null>(
  null,
);
const importJson = ref(
  JSON.stringify(
    {
      source: "FIXTURE_LOCAL",
      sourceVersion: "local-dev",
      collectedAt: new Date().toISOString(),
      points: [
        { percentileBps: 9000, medianKeyThreshold: 18 },
        { percentileBps: 9900, medianKeyThreshold: 22 },
      ],
    },
    null,
    2,
  ),
);

async function fetchJson<T>(path: string, init?: { method?: string; body?: string }): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    credentials: "include",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    ...init,
  });
  const payload = (await response.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      void router.replace(response.status === 401 ? "/auth/signin" : "/access-denied");
    }
    throw new ApiClientError(payload.error?.message ?? "Request failed", response.status, "HTTP_ERROR");
  }
  return payload;
}

const editing = computed(() => state.value?.draft ?? null);
const readonlyRevision = computed(() => (state.value?.draft ? null : state.value?.published ?? null));
const displayed = computed(() => editing.value ?? readonlyRevision.value);
const readOnly = computed(() => !editing.value);

function assignmentTier(classSlug: string, specSlug: string): string {
  const hit = displayed.value?.specAssignments.find(
    (a) => a.classSlug === classSlug && a.specSlug === specSlug,
  );
  return hit ? String(hit.tier) : "";
}

const scoringSeasonLabel = computed(() => {
  const effective = scoringSeason.value?.effectiveScoringSeason;
  if (!effective) return "—";
  return formatScoringSeasonLabel(effective);
});

const scoringSeasonModeLabel = computed(() => {
  const mode = scoringSeason.value?.selection.mode;
  if (mode === "PINNED") return "Pinned";
  if (mode === "AUTO") return "Auto";
  return "—";
});

async function loadScoringSeasonAuthority(): Promise<void> {
  const status = await fetchJson<ScoringSeasonSelectionStatusDTO>(
    "/api/v1/admin/misc/scoring-season?region=EU",
  );
  scoringSeason.value = status;
  const id = status.effectiveScoringSeason?.id;
  if (!id) {
    throw new Error("No effective scoring season is resolved. Set it on Admin misc.");
  }
  seasonId.value = id;
}

async function loadState(): Promise<void> {
  if (!seasonId.value) return;
  state.value = await fetchJson<SeasonState>(`/api/v1/admin/seasons/${seasonId.value}/score-context`);
}

onMounted(async () => {
  try {
    await loadScoringSeasonAuthority();
    await loadState();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
});

async function createDraft(): Promise<void> {
  busy.value = true;
  error.value = null;
  try {
    await fetchJson(`/api/v1/admin/seasons/${seasonId.value}/score-context/draft`, { method: "POST" });
    await loadState();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

async function saveDraft(): Promise<void> {
  if (!editing.value) return;
  busy.value = true;
  error.value = null;
  try {
    await fetchJson(`/api/v1/admin/score-context/revisions/${editing.value.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        tierFactors: editing.value.tierFactors,
        specAssignments: editing.value.specAssignments,
        percentileAnchors: editing.value.percentileAnchors,
        distributionSnapshotId: editing.value.distribution?.id ?? state.value?.distributions[0]?.id ?? null,
      }),
    });
    await loadState();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

async function publish(): Promise<void> {
  if (!editing.value) return;
  busy.value = true;
  error.value = null;
  try {
    const result = await fetchJson<{
      recalc: { status: RecalcStatus; bulkOperationId: string | null; error: string | null; retryAvailable?: boolean };
    }>(`/api/v1/admin/score-context/revisions/${editing.value.id}/publish`, { method: "POST" });
    recalc.value = result.recalc;
    await loadState();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

async function retryRecalc(): Promise<void> {
  busy.value = true;
  try {
    const result = await fetchJson<{
      recalc: { status: RecalcStatus; bulkOperationId: string | null; error: string | null; retryAvailable?: boolean };
    }>(`/api/v1/admin/seasons/${seasonId.value}/score-context/recalculate`, { method: "POST" });
    recalc.value = result.recalc;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

async function importDistribution(): Promise<void> {
  busy.value = true;
  error.value = null;
  try {
    const parsed = JSON.parse(importJson.value) as Record<string, unknown>;
    await fetchJson(`/api/v1/admin/seasons/${seasonId.value}/score-context/distributions`, {
      method: "POST",
      body: JSON.stringify(parsed),
    });
    await loadState();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

function setTierFactor(tier: 1 | 2 | 3 | 4 | 5, value: number): void {
  if (!editing.value) return;
  editing.value.tierFactors[tier] = value;
}

function setSpecTier(classSlug: string, specSlug: string, raw: string): void {
  if (!editing.value) return;
  editing.value.specAssignments = editing.value.specAssignments.filter(
    (a) => !(a.classSlug === classSlug && a.specSlug === specSlug),
  );
  if (!raw) return;
  const tier = Number(raw) as 1 | 2 | 3 | 4 | 5;
  editing.value.specAssignments.push({ classSlug, specSlug, tier });
}

function setAnchorFactor(bps: number, factor: number): void {
  if (!editing.value) return;
  const row = editing.value.percentileAnchors.find((a) => a.percentileBps === bps);
  if (row) row.factor = factor;
  const resolved = editing.value.resolvedAnchors.find((a) => a.percentileBps === bps);
  if (resolved) resolved.factor = factor;
}

const newAnchorBps = ref(9000);
const newAnchorFactor = ref(1);

function addAnchor(): void {
  if (!editing.value) return;
  const percentileBps = Math.round(Number(newAnchorBps.value));
  const factor = Number(newAnchorFactor.value);
  if (!Number.isInteger(percentileBps) || percentileBps < 1 || percentileBps > 10000) {
    error.value = "percentileBps must be an integer from 1 to 10000";
    return;
  }
  if (!Number.isFinite(factor) || factor <= 0) {
    error.value = "Anchor factor must be a finite number greater than 0";
    return;
  }
  if (editing.value.percentileAnchors.some((a) => a.percentileBps === percentileBps)) {
    error.value = "Duplicate percentileBps";
    return;
  }
  error.value = null;
  editing.value.percentileAnchors.push({ percentileBps, factor });
  editing.value.resolvedAnchors.push({
    percentileBps,
    percentileLabel: formatPercentileBpsLabel(percentileBps),
    medianKeyThreshold: null,
    factor,
  });
}

function removeAnchor(percentileBps: number): void {
  if (!editing.value) return;
  editing.value.percentileAnchors = editing.value.percentileAnchors.filter((a) => a.percentileBps !== percentileBps);
  editing.value.resolvedAnchors = editing.value.resolvedAnchors.filter((a) => a.percentileBps !== percentileBps);
}
</script>

<template>
  <section class="ctx" :data-embedded="props.embedded ? 'true' : 'false'" data-testid="admin-score-context">
    <header>
      <h2>Key + Meta Context</h2>
      <p class="muted">
        Key + meta context for the platform scoring season. Change the scoring season on
        <RouterLink to="/admin/misc">Admin misc</RouterLink>.
      </p>
    </header>

    <StatusBanner v-if="error" tone="error" :message="error" />
    <StatusBanner
      v-if="recalc?.status === 'QUEUED'"
      tone="success"
      :message="`Recalculation queued (${recalc.bulkOperationId ?? 'bulk'}). Public profiles update as characters finish.`"
    />
    <StatusBanner
      v-if="recalc?.status === 'ENQUEUE_FAILED'"
      tone="error"
      :message="`Published, but recalculation enqueue failed: ${recalc.error ?? 'unknown'}`"
    />

    <dl class="season-authority" data-testid="scoring-season-header">
      <div>
        <dt>Scoring season</dt>
        <dd data-testid="scoring-season-label">{{ scoringSeasonLabel }}</dd>
      </div>
      <div>
        <dt>Mode</dt>
        <dd data-testid="scoring-season-mode">{{ scoringSeasonModeLabel }}</dd>
      </div>
    </dl>

    <p v-if="state" class="meta" data-testid="revision-status">
      Status: {{ displayed?.status ?? "none" }}
      · version {{ displayed?.version ?? "—" }}
      · distribution {{ displayed?.distribution?.source ?? "not imported" }}
      {{ displayed?.distribution?.collectedAt ? `· collected ${displayed.distribution.collectedAt}` : "" }}
    </p>
    <p v-if="state?.distributionMissing" class="warn" data-testid="missing-distribution">
      No median-key distribution imported for this season
    </p>

    <div class="actions">
      <button type="button" class="btn" :disabled="busy || !seasonId" data-testid="create-draft" @click="createDraft">
        Create / open draft
      </button>
      <button type="button" class="btn" :disabled="busy || readOnly" data-testid="save-draft" @click="saveDraft">
        Save draft
      </button>
      <button type="button" class="btn" :disabled="busy || readOnly" data-testid="publish-draft" @click="publish">
        Publish
      </button>
      <button
        v-if="recalc?.retryAvailable"
        type="button"
        class="btn"
        data-testid="retry-recalc"
        @click="retryRecalc"
      >
        Retry recalculation
      </button>
    </div>
    <p v-if="readOnly && displayed?.status === 'PUBLISHED'" class="muted" data-testid="published-readonly">
      Published revisions are read-only. Open a draft to edit.
    </p>
    <ul v-if="state?.history?.length" data-testid="revision-history" class="muted">
      <li v-for="row in state.history" :key="row.id">
        v{{ row.version }} · {{ row.status }}
        {{ row.publishedAt ? `· published ${row.publishedAt}` : "" }}
      </li>
    </ul>

    <section v-if="displayed">
      <h3>Meta tiers</h3>
      <p class="muted">1 = niche / weak · 2 = below-meta · 3 = average · 4 = strong · 5 = top-tier meta</p>
      <div class="tiers">
        <label v-for="tier in [1, 2, 3, 4, 5] as const" :key="tier">
          Tier {{ tier }}
          <input
            :value="displayed.tierFactors[tier]"
            type="number"
            min="0.01"
            step="0.01"
            :disabled="readOnly"
            :data-testid="`tier-factor-${tier}`"
            @change="setTierFactor(tier, Number(($event.target as HTMLInputElement).value))"
          />
        </label>
      </div>

      <h3>Specializations</h3>
      <div v-for="cls in state?.canonicalSpecializations.classes ?? []" :key="cls.slug" class="class-block">
        <h4>{{ cls.name }}</h4>
        <label v-for="spec in cls.specs" :key="`${cls.slug}-${spec.slug}`">
          {{ spec.name }}
          <select
            :value="assignmentTier(cls.slug, spec.slug)"
            :disabled="readOnly"
            :data-testid="`spec-${cls.slug}-${spec.slug}`"
            @change="setSpecTier(cls.slug, spec.slug, ($event.target as HTMLSelectElement).value)"
          >
            <option value="">Unconfigured</option>
            <option value="1">Tier 1</option>
            <option value="2">Tier 2</option>
            <option value="3">Tier 3</option>
            <option value="4">Tier 4</option>
            <option value="5">Tier 5</option>
          </select>
        </label>
      </div>

      <h3>Key difficulty</h3>
      <p class="muted">{{ state?.canonicalSpecializations.stepBandHelp }}</p>
      <table v-if="displayed.resolvedAnchors.length" data-testid="anchor-table">
        <thead>
          <tr>
            <th>Percentile</th>
            <th>Median key</th>
            <th>Factor</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="anchor in displayed.resolvedAnchors" :key="anchor.percentileBps">
            <td>{{ anchor.percentileLabel }}</td>
            <td data-testid="anchor-threshold">
              {{ anchor.medianKeyThreshold == null ? "—" : `+${anchor.medianKeyThreshold}` }}
            </td>
            <td>
              <input
                :value="anchor.factor"
                type="number"
                min="0.01"
                step="0.01"
                :disabled="readOnly"
                @change="setAnchorFactor(anchor.percentileBps, Number(($event.target as HTMLInputElement).value))"
              />
            </td>
            <td>
              <button
                type="button"
                class="btn"
                :disabled="readOnly"
                :data-testid="`remove-anchor-${anchor.percentileBps}`"
                @click="removeAnchor(anchor.percentileBps)"
              >
                Remove
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="!readOnly" class="actions" data-testid="add-anchor-row">
        <label>
          percentileBps
          <input v-model.number="newAnchorBps" type="number" min="1" max="10000" step="1" />
        </label>
        <label>
          factor
          <input v-model.number="newAnchorFactor" type="number" min="0.01" step="0.01" />
        </label>
        <button type="button" class="btn" data-testid="add-anchor" @click="addAnchor">Add percentile anchor</button>
      </div>
    </section>

    <section>
      <h3>Import distribution snapshot</h3>
      <p class="muted">Paste JSON. Snapshots are immutable. Do not generate thresholds from live providers.</p>
      <textarea v-model="importJson" rows="10" data-testid="distribution-json" />
      <button type="button" class="btn" :disabled="busy || !seasonId" data-testid="import-distribution" @click="importDistribution">
        Import
      </button>
    </section>
  </section>
</template>

<style scoped>
.ctx {
  display: grid;
  gap: var(--space-4);
}
.muted {
  color: var(--color-text-muted);
}
.season-authority {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  margin: 0;
}
.season-authority dt {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}
.season-authority dd {
  margin: 0.15rem 0 0;
  font-weight: 600;
}
.warn {
  color: var(--color-gold-300);
}
.field,
.tiers label,
.class-block label {
  display: grid;
  gap: 0.25rem;
  font-weight: 600;
}
.actions,
.tiers {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.class-block {
  display: grid;
  gap: 0.35rem;
  margin-bottom: 0.75rem;
}
.btn {
  appearance: none;
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: inherit;
  font: inherit;
  padding: 0.4rem 0.75rem;
  border-radius: var(--radius-sm);
  cursor: pointer;
}
table {
  width: 100%;
  border-collapse: collapse;
}
th,
td {
  text-align: left;
  padding: 0.35rem 0.5rem;
  border-bottom: 1px solid var(--color-border);
}
textarea {
  width: 100%;
  font-family: var(--font-data);
}
</style>
