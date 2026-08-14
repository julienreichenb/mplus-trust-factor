<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter, RouterLink } from "vue-router";
import type { ScoringSeasonSelectionStatusDTO } from "@mplus/contracts";
import { formatPercentileBpsLabel } from "@mplus/contracts";
import { ApiClientError } from "../api/live-client";
import StatusBanner from "../components/common/StatusBanner.vue";
import ScoreContextKeyTable from "../components/admin/ScoreContextKeyTable.vue";
import ScoreContextMetaTierList, {
  type MetaTier,
} from "../components/admin/ScoreContextMetaTierList.vue";
import { formatScoringSeasonLabel } from "../lib/scoringSeasonLabel";
import { adminScoringSeasonQuery } from "../lib/adminScoringRegion";

const props = defineProps<{ embedded?: boolean }>();

const router = useRouter();
const apiBase = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

type RecalcStatus = "QUEUED" | "ENQUEUE_FAILED" | "NO_SCORES" | null;
type TabId = "key" | "meta";

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
  publishedAt?: string | null;
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
  latestDistribution: {
    id: string;
    source: string;
    sourceVersion: string | null;
    collectedAt: string;
    points: Array<{ percentileBps: number; medianKeyThreshold: number }>;
  } | null;
  distributionMissing: boolean;
  canonicalSpecializations: { classes: SpecClass[]; stepBandHelp: string; tierSemantics: Record<string, string> };
}

const scoringSeason = ref<ScoringSeasonSelectionStatusDTO | null>(null);
const seasonId = ref("");
const state = ref<SeasonState | null>(null);
const working = ref<RevisionView | null>(null);
const error = ref<string | null>(null);
const busy = ref(false);
const dirty = ref(false);
const activeTab = ref<TabId>("key");
const recalc = ref<{ status: RecalcStatus; bulkOperationId: string | null; error: string | null; retryAvailable?: boolean } | null>(
  null,
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

const displayed = computed(() => working.value);
const isDraft = computed(() => working.value?.status === "DRAFT");
const publishedMarked = computed(() => state.value?.published != null && !state.value.draft && !dirty.value);

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

const keyRows = computed(() => {
  const latest = state.value?.latestDistribution;
  const revision = working.value;
  if (latest?.points.length) {
    const factorByBps = new Map((revision?.percentileAnchors ?? []).map((a) => [a.percentileBps, a.factor]));
    const resolvedByBps = new Map((revision?.resolvedAnchors ?? []).map((a) => [a.percentileBps, a]));
    return latest.points.map((point) => {
      const resolved = resolvedByBps.get(point.percentileBps);
      return {
        percentileBps: point.percentileBps,
        percentileLabel: formatPercentileBpsLabel(point.percentileBps),
        medianKeyThreshold: point.medianKeyThreshold,
        factor: resolved?.factor ?? factorByBps.get(point.percentileBps) ?? 1,
      };
    });
  }
  return revision?.resolvedAnchors ?? [];
});

const distributionUnavailable = computed(() => Boolean(state.value?.distributionMissing));

const provenanceLabel = computed(() => {
  const source = working.value?.distribution?.source ?? state.value?.latestDistribution?.source;
  if (!source) return null;
  const normalized = source.toUpperCase();
  if (normalized.includes("RAIDER")) return "Raider.IO";
  return "Season snapshot";
});

const provenanceUpdated = computed(() => {
  const iso = working.value?.distribution?.collectedAt ?? state.value?.latestDistribution?.collectedAt;
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
});

function cloneRevision(revision: RevisionView): RevisionView {
  return JSON.parse(JSON.stringify(revision)) as RevisionView;
}

function syncWorkingFromState(): void {
  const next = state.value?.draft ?? state.value?.published ?? null;
  working.value = next ? cloneRevision(next) : null;
  dirty.value = false;
}

async function loadScoringSeasonAuthority(): Promise<void> {
  const status = await fetchJson<ScoringSeasonSelectionStatusDTO>(adminScoringSeasonQuery());
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
  syncWorkingFromState();
}

onMounted(async () => {
  try {
    await loadScoringSeasonAuthority();
    await loadState();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
});

async function ensureDraft(): Promise<void> {
  if (working.value?.status === "DRAFT") return;
  if (!seasonId.value) return;
  const created = await fetchJson<RevisionView>(`/api/v1/admin/seasons/${seasonId.value}/score-context/draft`, {
    method: "POST",
  });
  const local = working.value;
  working.value = {
    ...created,
    tierFactors: local?.tierFactors ?? created.tierFactors,
    specAssignments: local?.specAssignments ?? created.specAssignments,
    percentileAnchors: local?.percentileAnchors ?? created.percentileAnchors,
    resolvedAnchors: local?.resolvedAnchors ?? created.resolvedAnchors,
  };
  if (state.value) state.value.draft = working.value;
}

async function saveDraft(): Promise<void> {
  await ensureDraft();
  if (!working.value) return;
  busy.value = true;
  error.value = null;
  try {
    await fetchJson(`/api/v1/admin/score-context/revisions/${working.value.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        tierFactors: working.value.tierFactors,
        specAssignments: working.value.specAssignments,
        percentileAnchors: working.value.percentileAnchors,
        distributionSnapshotId:
          working.value.distribution?.id ?? state.value?.latestDistribution?.id ?? null,
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
  if (dirty.value) await saveDraft();
  await ensureDraft();
  if (!working.value) return;
  busy.value = true;
  error.value = null;
  try {
    const result = await fetchJson<{
      recalc: { status: RecalcStatus; bulkOperationId: string | null; error: string | null; retryAvailable?: boolean };
    }>(`/api/v1/admin/score-context/revisions/${working.value.id}/publish`, { method: "POST" });
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

async function setTierFactor(tier: MetaTier, value: number): Promise<void> {
  await ensureDraft();
  if (!working.value) return;
  working.value.tierFactors[tier] = value;
  dirty.value = true;
}

async function moveSpec(classSlug: string, specSlug: string, tier: MetaTier | null): Promise<void> {
  await ensureDraft();
  if (!working.value) return;
  working.value.specAssignments = working.value.specAssignments.filter(
    (a) => !(a.classSlug === classSlug && a.specSlug === specSlug),
  );
  if (tier) working.value.specAssignments.push({ classSlug, specSlug, tier });
  dirty.value = true;
}

async function setAnchorFactor(bps: number, factor: number): Promise<void> {
  await ensureDraft();
  if (!working.value) return;
  const row = working.value.percentileAnchors.find((a) => a.percentileBps === bps);
  if (row) row.factor = factor;
  else working.value.percentileAnchors.push({ percentileBps: bps, factor });
  const resolved = working.value.resolvedAnchors.find((a) => a.percentileBps === bps);
  if (resolved) resolved.factor = factor;
  else {
    working.value.resolvedAnchors.push({
      percentileBps: bps,
      percentileLabel: formatPercentileBpsLabel(bps),
      medianKeyThreshold: state.value?.latestDistribution?.points.find((p) => p.percentileBps === bps)?.medianKeyThreshold ?? null,
      factor,
    });
  }
  dirty.value = true;
}
</script>

<template>
  <section class="ctx" :data-embedded="props.embedded ? 'true' : 'false'" data-testid="admin-score-context">
    <header>
      <h2>Key + Meta Context</h2>
      <p class="muted">
        Applies to the platform scoring season. Change the scoring season on
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

    <p class="meta" data-testid="revision-status">
      <span v-if="isDraft">Draft v{{ displayed?.version ?? "—" }}</span>
      <span v-else-if="state?.published">Published v{{ state.published.version }}</span>
      <span v-else>No published revision</span>
      <span v-if="dirty" class="unsaved" data-testid="unsaved-changes"> · Unsaved changes</span>
    </p>
    <p v-if="provenanceLabel" class="provenance" data-testid="distribution-provenance">
      Season data: {{ provenanceLabel }}
      <span v-if="provenanceUpdated"> · Updated: {{ provenanceUpdated }}</span>
    </p>

    <div class="actions">
      <button type="button" class="btn" :disabled="busy || !seasonId || !dirty && !isDraft" data-testid="save-draft" @click="saveDraft">
        Save draft
      </button>
      <button type="button" class="btn" :disabled="busy || !seasonId" data-testid="publish-draft" @click="publish">
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
    <p v-if="publishedMarked" class="muted" data-testid="published-readonly">
      Published revision is live. Editing a factor opens a draft.
    </p>

    <nav class="tabs" aria-label="Score context sections">
      <button
        type="button"
        class="tab"
        :class="{ 'tab--active': activeTab === 'key' }"
        data-testid="tab-key"
        @click="activeTab = 'key'"
      >
        Key
      </button>
      <button
        type="button"
        class="tab"
        :class="{ 'tab--active': activeTab === 'meta' }"
        data-testid="tab-meta"
        @click="activeTab = 'meta'"
      >
        Meta
      </button>
    </nav>

    <ScoreContextKeyTable
      v-if="activeTab === 'key'"
      :rows="keyRows"
      :unavailable="distributionUnavailable"
      :read-only="false"
      @update-factor="setAnchorFactor"
    />
    <ScoreContextMetaTierList
      v-else
      :classes="state?.canonicalSpecializations.classes ?? []"
      :assignments="displayed?.specAssignments ?? []"
      :tier-factors="displayed?.tierFactors ?? { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 }"
      :read-only="false"
      @move-spec="moveSpec"
      @update-tier-factor="setTierFactor"
    />
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
.meta,
.provenance {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}
.unsaved {
  color: #f0c674;
  font-weight: 600;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 2.5rem;
  padding: 0.45rem 1rem;
  border: none;
  border-radius: 0.4rem;
  background: #1f6feb;
  color: #fff;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.tabs {
  display: flex;
  gap: 0.35rem;
  flex-wrap: wrap;
}
.tab {
  padding: 0.55rem 0.9rem;
  border: 1px solid rgb(255 255 255 / 14%);
  background: transparent;
  color: inherit;
  border-radius: 0.35rem;
  cursor: pointer;
}
.tab--active {
  background: rgb(255 255 255 / 10%);
  border-color: rgb(255 255 255 / 28%);
}
</style>
