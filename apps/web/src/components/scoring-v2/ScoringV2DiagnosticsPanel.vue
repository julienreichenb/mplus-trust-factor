<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import type {
  ExplainabilityV2ManifestListDTO,
  ScoreExplainabilityV2AdminDTO,
  ScoringV2EvidenceAuditDocument,
} from "@mplus/contracts";
import { ApiClientError } from "../../api/live-client";
import StatusBanner from "../common/StatusBanner.vue";

const router = useRouter();
const apiBase = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

const characterId = ref("");
const seasonId = ref("");
const manifestId = ref("");
const busy = ref(false);
const error = ref<string | null>(null);
const list = ref<ExplainabilityV2ManifestListDTO | null>(null);
const diagnostics = ref<ScoreExplainabilityV2AdminDTO | null>(null);
const evidenceAudit = ref<ScoringV2EvidenceAuditDocument | null>(null);
const showRaw = ref(false);

const bannerText = computed(() => error.value ?? "");
const matrixByDungeon = computed(() => {
  const rows = diagnostics.value?.matrix ?? [];
  const map = new Map<string, typeof rows>();
  for (const cell of rows) {
    const listForDungeon = map.get(cell.dungeonSlug) ?? [];
    listForDungeon.push(cell);
    map.set(cell.dungeonSlug, listForDungeon);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
});

function handleAuthError(err: unknown): boolean {
  if (err instanceof ApiClientError && (err.status === 401 || err.status === 403)) {
    void router.replace(err.status === 401 ? "/auth/signin" : "/access-denied");
    return true;
  }
  return false;
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    method: "GET",
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  const payload = (await response.json().catch(() => ({}))) as T & {
    error?: { message?: string };
  };
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      void router.replace(response.status === 401 ? "/auth/signin" : "/access-denied");
      throw new ApiClientError(
        payload.error?.message ?? "Unauthorized",
        response.status,
        "UNAUTHORIZED",
      );
    }
    throw new ApiClientError(
      payload.error?.message ?? `Request failed (${response.status})`,
      response.status,
      "REQUEST_FAILED",
    );
  }
  return payload;
}

async function loadManifests(): Promise<void> {
  busy.value = true;
  error.value = null;
  try {
    const params = new URLSearchParams();
    if (characterId.value.trim()) params.set("characterId", characterId.value.trim());
    if (seasonId.value.trim()) params.set("seasonId", seasonId.value.trim());
    params.set("limit", "20");
    list.value = await fetchJson<ExplainabilityV2ManifestListDTO>(
      `/api/v1/admin/scoring-v2/manifests?${params.toString()}`,
    );
  } catch (err) {
    if (!handleAuthError(err)) {
      error.value = err instanceof Error ? err.message : "Failed to load manifests";
    }
  } finally {
    busy.value = false;
  }
}

async function loadEvidenceAudit(id: string): Promise<void> {
  evidenceAudit.value = await fetchJson<ScoringV2EvidenceAuditDocument>(
    `/api/v1/admin/scoring-v2/manifests/${encodeURIComponent(id)}/evidence-audit`,
  );
}

async function loadDiagnostics(): Promise<void> {
  const id = characterId.value.trim();
  if (!id) {
    error.value = "Character ID is required for diagnostics.";
    return;
  }
  busy.value = true;
  error.value = null;
  diagnostics.value = null;
  evidenceAudit.value = null;
  try {
    const params = new URLSearchParams();
    if (seasonId.value.trim()) params.set("seasonId", seasonId.value.trim());
    if (manifestId.value.trim()) params.set("manifestId", manifestId.value.trim());
    const qs = params.toString();
    diagnostics.value = await fetchJson<ScoreExplainabilityV2AdminDTO>(
      `/api/v1/admin/scoring-v2/characters/${encodeURIComponent(id)}/explainability${qs ? `?${qs}` : ""}`,
    );
    const auditManifestId = manifestId.value.trim() || diagnostics.value.manifestId;
    if (auditManifestId) {
      await loadEvidenceAudit(auditManifestId);
    }
  } catch (err) {
    if (!handleAuthError(err)) {
      error.value = err instanceof Error ? err.message : "Failed to load diagnostics";
    }
  } finally {
    busy.value = false;
  }
}

function selectManifest(id: string, character: string, season: string): void {
  manifestId.value = id;
  characterId.value = character;
  seasonId.value = season;
  void loadDiagnostics();
}

function downloadEvidenceAudit(): void {
  if (!evidenceAudit.value) return;
  const blob = new Blob([JSON.stringify(evidenceAudit.value, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `scoring-v2-evidence-audit-${evidenceAudit.value.manifestId}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

onMounted(() => {
  void loadManifests();
});

watch([characterId, seasonId], () => {
  // Keep list scoped when filters change; do not auto-fetch diagnostics.
});
</script>

<template>
  <div class="diagnostics" aria-labelledby="diagnostics-title">
    <header class="diagnostics__header">
      <h2 id="diagnostics-title">Character and manifest diagnostics</h2>
      <p>
        Evidence quality, selection matrix, datasets, fact-set versions, dimension confidence, and
        V1/V2 comparison. Report codes are admin-only and never shown on public profiles.
      </p>
    </header>

    <StatusBanner v-if="bannerText" :tone="'error'" :message="bannerText" />

    <form class="filters" @submit.prevent="loadManifests">
      <label>
        Character ID
        <input v-model="characterId" type="text" name="characterId" autocomplete="off" />
      </label>
      <label>
        Season ID
        <input v-model="seasonId" type="text" name="seasonId" autocomplete="off" />
      </label>
      <label>
        Manifest ID
        <input v-model="manifestId" type="text" name="manifestId" autocomplete="off" />
      </label>
      <div class="filters__actions">
        <button type="submit" :disabled="busy">List manifests</button>
        <button type="button" :disabled="busy" @click="loadDiagnostics">Load diagnostics</button>
      </div>
    </form>

    <section v-if="list" class="panel" aria-labelledby="manifest-list-title">
      <h3 id="manifest-list-title">Manifests</h3>
      <p v-if="!list.items.length" class="empty">No manifests found.</p>
      <table v-else>
        <thead>
          <tr>
            <th>Frozen</th>
            <th>Coverage</th>
            <th>Slots</th>
            <th>Season</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in list.items" :key="item.manifestId">
            <td>{{ item.frozenAt }}</td>
            <td><span class="chip">{{ item.coverageState }}</span></td>
            <td>{{ item.selectedSlotCount }}/{{ item.expectedSlotCount }}</td>
            <td>{{ item.seasonSlug ?? item.seasonId }}</td>
            <td>
              <button
                type="button"
                @click="selectManifest(item.manifestId, item.characterId, item.seasonId)"
              >
                Open
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <template v-if="diagnostics">
      <section class="panel" aria-labelledby="matrix-title">
        <h3 id="matrix-title">2×dungeon matrix</h3>
        <p>
          <span class="chip">{{ diagnostics.coverageState }}</span>
          · selected {{ diagnostics.selectedSlotCount }}/{{ diagnostics.expectedSlotCount }} · hash
          <span class="mono">{{ diagnostics.manifestContentHash.slice(0, 12) }}…</span>
        </p>
        <div v-for="[dungeon, cells] in matrixByDungeon" :key="dungeon" class="matrix-row">
          <h4>{{ dungeon }}</h4>
          <ul>
            <li v-for="cell in cells" :key="`${cell.dungeonSlug}-${cell.slotIndex}`">
              Slot {{ cell.slotIndex }} ·
              <span class="chip chip--muted">{{ cell.state }}</span>
              · +{{ cell.keyLevel ?? "—" }}
              <span v-if="cell.reportCode" class="mono">
                · {{ cell.reportCode }}#{{ cell.fightId ?? "—" }}
                <template v-if="cell.reportRevision != null">r{{ cell.reportRevision }}</template>
              </span>
              <span v-if="cell.selectionReason"> · {{ cell.selectionReason }}</span>
              <span v-if="cell.candidateRank != null"> · rank {{ cell.candidateRank }}</span>
              <span v-if="cell.fallbackUsed && cell.fallbackReason">
                · fallback {{ cell.fallbackReason }}
              </span>
            </li>
          </ul>
        </div>
      </section>

      <section v-if="evidenceAudit" class="panel" aria-labelledby="lineage-title">
        <h3 id="lineage-title">Evidence lineage audit</h3>
        <p>
          Provider-free source → facts → scorer lineage.
          <span class="chip">{{ evidenceAudit.coverageState }}</span>
          · {{ evidenceAudit.selectedSlotCount }}/{{ evidenceAudit.expectedSlotCount }} slots
          · registry {{ evidenceAudit.featureRegistryVersion }}
          · provider calls {{ evidenceAudit.providerCallCount }}
        </p>
        <p v-if="evidenceAudit.replay">
          Replay:
          <span class="chip">{{ evidenceAudit.replay.deterministicMatch ? "deterministic" : "drift" }}</span>
          · score {{ evidenceAudit.replay.scoreMatch ? "match" : "mismatch" }}
          · fingerprint {{ evidenceAudit.replay.inputFingerprintMatch ? "match" : "mismatch" }}
        </p>
        <p v-if="evidenceAudit.integrityFailures.length" class="audit-warn">
          Integrity: {{ evidenceAudit.integrityFailures.slice(0, 5).join("; ") }}
          <template v-if="evidenceAudit.integrityFailures.length > 5">
            · +{{ evidenceAudit.integrityFailures.length - 5 }} more
          </template>
        </p>
        <div class="filters__actions">
          <button type="button" :disabled="busy" @click="downloadEvidenceAudit">
            Download evidence audit JSON
          </button>
        </div>
        <table>
          <thead>
            <tr>
              <th>Dungeon</th>
              <th>Slot</th>
              <th>Source</th>
              <th>Datasets</th>
              <th>Facts</th>
              <th>Survival</th>
              <th>Utility</th>
              <th>Performance</th>
              <th>Audit state</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in evidenceAudit.matrix"
              :key="`${row.dungeonSlug}-${row.slotIndex}`"
            >
              <td>{{ row.dungeonSlug }}</td>
              <td>{{ row.slotIndex }}</td>
              <td><span class="chip chip--muted">{{ row.source }}</span></td>
              <td>{{ row.datasets }}</td>
              <td>{{ row.facts }}</td>
              <td>{{ row.survival }}</td>
              <td>{{ row.utility }}</td>
              <td>{{ row.performance }}</td>
              <td><span class="chip">{{ row.auditState }}</span></td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="panel" aria-labelledby="rejected-title">
        <h3 id="rejected-title">Rejected candidates</h3>
        <p v-if="!diagnostics.rejectedCandidates.length" class="empty">None recorded.</p>
        <ul v-else>
          <li v-for="(row, idx) in diagnostics.rejectedCandidates" :key="`${row.reportCode}-${idx}`">
            <span class="mono">{{ row.reportCode }}#{{ row.fightId }}</span>
            · {{ row.dungeonSlug ?? "—" }} · {{ row.reason }}
            <span v-if="row.detail"> — {{ row.detail }}</span>
          </li>
        </ul>
      </section>

      <section class="panel" aria-labelledby="datasets-title">
        <h3 id="datasets-title">Datasets</h3>
        <table v-if="diagnostics.datasets.length">
          <thead>
            <tr>
              <th>Key</th>
              <th>State</th>
              <th>Pages</th>
              <th>Events</th>
              <th>Truncated</th>
              <th>Points</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(ds, idx) in diagnostics.datasets" :key="`${ds.datasetKey}-${idx}`">
              <td>{{ ds.datasetKey }}</td>
              <td><span class="chip">{{ ds.state }}</span></td>
              <td>{{ ds.pageCount }}</td>
              <td>{{ ds.eventCount }}</td>
              <td>{{ ds.truncated ? "yes" : "no" }}</td>
              <td>{{ ds.pointsConsumed ?? "—" }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="empty">No datasets.</p>
      </section>

      <section class="panel" aria-labelledby="factsets-title">
        <h3 id="factsets-title">Fact-set versions</h3>
        <ul v-if="diagnostics.factSets.length">
          <li v-for="fs in diagnostics.factSets" :key="fs.id">
            {{ fs.extractorFamily }}@{{ fs.extractorVersion }} · schema {{ fs.schemaVersion }} ·
            keys {{ fs.factKeys.join(", ") || "—" }}
          </li>
        </ul>
        <p v-else class="empty">No fact sets.</p>
      </section>

      <section class="panel" aria-labelledby="dims-title">
        <h3 id="dims-title">Dimension calculation and confidence</h3>
        <table v-if="diagnostics.dimensions.length">
          <thead>
            <tr>
              <th>Dimension</th>
              <th>Score</th>
              <th>Confidence</th>
              <th>Availability</th>
              <th>Lifecycle</th>
              <th>Algorithm</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="dim in diagnostics.dimensions" :key="dim.dimension">
              <td>{{ dim.dimension }}</td>
              <td>{{ dim.score ?? "U" }}</td>
              <td>{{ (dim.confidence * 100).toFixed(0) }}%</td>
              <td><span class="chip">{{ dim.availabilityState }}</span></td>
              <td>{{ dim.lifecycleState }}</td>
              <td class="mono">{{ dim.algorithmVersion }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="empty">No dimension computations.</p>
      </section>

      <section class="panel" aria-labelledby="compare-title">
        <h3 id="compare-title">V1 / V2 comparison</h3>
        <dl v-if="diagnostics.comparison" class="kv">
          <template v-for="(value, key) in diagnostics.comparison" :key="String(key)">
            <dt>{{ key }}</dt>
            <dd class="mono">{{ typeof value === "object" ? JSON.stringify(value) : value }}</dd>
          </template>
        </dl>
        <p v-else class="empty">No comparison data.</p>
      </section>

      <section class="panel" aria-labelledby="queue-title">
        <h3 id="queue-title">Batch / queue state</h3>
        <dl v-if="diagnostics.batchQueue" class="kv">
          <template v-for="(value, key) in diagnostics.batchQueue" :key="String(key)">
            <dt>{{ key }}</dt>
            <dd class="mono">{{ typeof value === "object" ? JSON.stringify(value) : value }}</dd>
          </template>
        </dl>
        <p v-else class="empty">No analysis batch linked.</p>
      </section>

      <section class="panel" aria-labelledby="calib-title">
        <h3 id="calib-title">Calibration links</h3>
        <ul>
          <li v-for="link in diagnostics.calibrationLinks" :key="link.href">
            <router-link :to="link.href">{{ link.label }}</router-link>
          </li>
        </ul>
      </section>

      <section class="panel" aria-labelledby="public-title">
        <h3 id="public-title">Public view (sanitized preview)</h3>
        <p>
          Publication
          <span class="chip">{{
            diagnostics.publicView?.coverage.publicationState ?? "not publicly emittable"
          }}</span>
        </p>
        <dl v-if="diagnostics.publicView" class="kv">
          <dt>Coverage state</dt>
          <dd>{{ diagnostics.publicView.coverage.coverageState }}</dd>
          <dt>Analyzed runs</dt>
          <dd>
            {{ diagnostics.publicView.coverage.analyzedRunCount }}/{{
              diagnostics.publicView.coverage.expectedRunCount
            }}
          </dd>
        </dl>
        <p v-else class="empty">No publicly emittable projection (SHADOW / UNAVAILABLE / unpublished).</p>
      </section>

      <details class="raw" :open="showRaw">
        <summary @click.prevent="showRaw = !showRaw">Raw diagnostic JSON</summary>
        <pre v-if="showRaw">{{ JSON.stringify(diagnostics, null, 2) }}</pre>
      </details>
    </template>
  </div>
</template>

<style scoped>
.diagnostics {
  display: grid;
  gap: var(--space-4, 1rem);
}

.diagnostics__header h2 {
  margin: 0 0 0.35rem;
  font-size: 1.15rem;
}

.filters {
  display: grid;
  gap: 0.75rem;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  align-items: end;
}

.filters label {
  display: grid;
  gap: 0.25rem;
  font-size: 0.9rem;
}

.filters input {
  padding: 0.4rem 0.5rem;
}

.filters__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.panel {
  display: grid;
  gap: 0.5rem;
  padding: 0.75rem 0;
  border-top: 1px solid color-mix(in srgb, currentColor 18%, transparent);
}

.panel h3 {
  margin: 0;
  font-size: 1.05rem;
}

.panel h4 {
  margin: 0.25rem 0;
  font-size: 0.95rem;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}

th,
td {
  text-align: left;
  padding: 0.35rem 0.4rem;
  border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent);
  vertical-align: top;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.85em;
}

.chip {
  display: inline-block;
  padding: 0.1rem 0.4rem;
  border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
  font-size: 0.8rem;
}

.chip--muted {
  opacity: 0.85;
}

.kv {
  display: grid;
  grid-template-columns: minmax(8rem, 12rem) 1fr;
  gap: 0.35rem 0.75rem;
  margin: 0;
  font-size: 0.9rem;
}

.kv dt {
  opacity: 0.8;
}

.kv dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.empty {
  opacity: 0.75;
}

.audit-warn {
  color: color-mix(in srgb, #b45309 80%, currentColor);
  font-size: 0.9rem;
}

.raw {
  border-top: 1px solid color-mix(in srgb, currentColor 18%, transparent);
  padding-top: 0.75rem;
}

.raw summary {
  cursor: pointer;
  font-weight: 600;
}

pre {
  overflow: auto;
  max-height: 320px;
  padding: 0.5rem;
  font-size: 0.8rem;
  background: color-mix(in srgb, currentColor 6%, transparent);
}

@media (max-width: 700px) {
  table {
    display: block;
    overflow-x: auto;
  }

  .kv {
    grid-template-columns: 1fr;
  }
}
</style>
