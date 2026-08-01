<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRoute } from "vue-router";
import type { CalibrationReportDTO, CalibrationRunDTO } from "@mplus/contracts";
import StatusBanner from "../components/common/StatusBanner.vue";

const apiBase = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";
const route = useRoute();
const runId = computed(() => String(route.params.runId));

const error = ref<string | null>(null);
const run = ref<CalibrationRunDTO | null>(null);
const report = ref<CalibrationReportDTO | null>(null);
const tab = ref<
  | "overview"
  | "comparison"
  | "ordering"
  | "dimensions"
  | "slices"
  | "characters"
  | "coverage"
  | "provenance"
>("overview");
const pollTimer = ref<ReturnType<typeof setInterval> | null>(null);

const fullReport = computed(() => (report.value?.report ?? null) as Record<string, unknown> | null);
const statistics = computed(() => (fullReport.value?.statistics as Record<string, unknown> | undefined) ?? null);
const characters = computed(() => {
  const rows = fullReport.value?.characters;
  return Array.isArray(rows) ? rows : [];
});
const comparison = computed(() => {
  const fromSummary = report.value?.summary?.activeDraftComparison;
  if (fromSummary) return fromSummary as Record<string, unknown>;
  return (fullReport.value?.activeDraftComparison as Record<string, unknown> | null) ?? null;
});
const comparisonAggregate = computed(
  () => (comparison.value?.aggregate as Record<string, unknown> | undefined) ?? null,
);
const comparisonCharacters = computed(() => {
  const rows = comparison.value?.characters;
  return Array.isArray(rows) ? rows : [];
});

async function apiJson<T>(path: string): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, { credentials: "include" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
  }
  return body as T;
}

async function load() {
  error.value = null;
  try {
    run.value = await apiJson<CalibrationRunDTO>(`/api/v1/admin/calibration/runs/${runId.value}`);
    if (run.value.hasReport || run.value.status === "SUCCEEDED") {
      report.value = await apiJson<CalibrationReportDTO>(
        `/api/v1/admin/calibration/runs/${runId.value}/report`,
      );
      stopPolling();
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}

function startPolling() {
  stopPolling();
  pollTimer.value = setInterval(() => {
    void load();
  }, 2500);
}

function stopPolling() {
  if (pollTimer.value) {
    clearInterval(pollTimer.value);
    pollTimer.value = null;
  }
}

onMounted(async () => {
  await load();
  if (run.value && (run.value.status === "QUEUED" || run.value.status === "RUNNING")) {
    startPolling();
  }
});
onUnmounted(stopPolling);
</script>

<template>
  <main class="admin-page">
    <header class="admin-page__header">
      <h1>Calibration report</h1>
      <p v-if="run">
        Run <code>{{ run.id }}</code> · {{ run.status }} · frozen cohort revision
        {{ run.cohortRevision }} · bundle {{ run.inputBundleContentHash.slice(0, 12) }}…
      </p>
    </header>

    <StatusBanner v-if="error" tone="error" :message="error" />
    <StatusBanner
      v-if="run && (run.status === 'QUEUED' || run.status === 'RUNNING')"
      tone="info"
      :message="`Run is ${run.status}. Polling until terminal…`"
    />
    <StatusBanner
      v-if="run?.errorMessage"
      tone="error"
      :message="`${run.errorCode ?? 'ERROR'}: ${run.errorMessage}`"
    />

    <nav v-if="report" class="tabs">
      <button
        v-for="t in [
          'overview',
          'comparison',
          'ordering',
          'dimensions',
          'slices',
          'characters',
          'coverage',
          'provenance',
        ]"
        :key="t"
        type="button"
        :class="{ active: tab === t }"
        @click="tab = t as typeof tab"
      >
        {{ t }}
      </button>
    </nav>

    <section v-if="report && tab === 'overview'" class="panel">
      <h2>Digest</h2>
      <p><strong>{{ report.digest.headline }}</strong></p>
      <p>
        Assessment {{ report.digest.overallAssessment }} · confidence {{ report.digest.confidence }} ·
        algorithm {{ report.digest.algorithmVersion }}
      </p>
      <p>
        Cohort {{ report.cohortSize }} · evaluated {{ report.evaluatedCount }} · failed/excluded
        {{ report.failedOrExcludedCount }} · Spearman {{ report.spearman ?? "n/a" }} · concordance
        {{ report.pairwiseConcordance ?? "n/a" }}
      </p>
      <h3>Strengths</h3>
      <ul>
        <li v-for="f in report.digest.strengths" :key="f.code">
          {{ f.title }} — {{ f.body }}
          <span class="muted">({{ f.metrics.map((m) => `${m.name}=${m.value}`).join(", ") }})</span>
        </li>
      </ul>
      <h3>Issues</h3>
      <ul>
        <li v-for="f in report.digest.issues" :key="f.code">
          {{ f.title }} — {{ f.body }}
        </li>
      </ul>
      <h3>Limitations</h3>
      <ul>
        <li v-for="f in report.digest.limitations" :key="f.code">{{ f.title }} — {{ f.body }}</li>
      </ul>
      <h3>Next actions (diagnostic only — no weight recommendations)</h3>
      <ul>
        <li v-for="f in report.digest.nextActions" :key="f.code">{{ f.title }} — {{ f.body }}</li>
      </ul>
    </section>

    <section v-else-if="report && tab === 'comparison'" class="panel">
      <h2>Active versus draft</h2>
      <p class="muted">
        modelActivated={{ report.summary?.modelActivated ?? false }} · providerCallsMade={{
          report.summary?.providerCallsMade ?? false
        }}
        — calibration never activates a model.
      </p>
      <template v-if="comparison">
        <p>{{ comparison.note }}</p>
        <h3>Aggregate deltas</h3>
        <pre>{{ JSON.stringify(comparisonAggregate, null, 2) }}</pre>
        <h3>Per-character score / grade / confidence / dimension deltas</h3>
        <table class="table">
          <thead>
            <tr>
              <th>Member</th>
              <th>Expert label</th>
              <th>Active score</th>
              <th>Draft score</th>
              <th>Δ score</th>
              <th>Grade</th>
              <th>Δ confidence</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in comparisonCharacters" :key="String((row as any).memberId)">
              <td>{{ (row as any).memberId }}</td>
              <td>{{ (row as any).expectedLabel }}</td>
              <td>{{ (row as any).activeOverallScore ?? "—" }}</td>
              <td>{{ (row as any).draftOverallScore ?? "—" }}</td>
              <td>{{ (row as any).scoreDelta ?? "—" }}</td>
              <td>{{ (row as any).gradeTransition ?? "—" }}</td>
              <td>{{ (row as any).confidenceDelta ?? "—" }}</td>
            </tr>
          </tbody>
        </table>
        <h3>Role / class / meta slice regressions</h3>
        <pre>{{
          JSON.stringify(
            {
              roleSlices: comparisonAggregate?.roleSlices,
              classSpecSlices: comparisonAggregate?.classSpecSlices,
              metaVersusNonMeta: comparisonAggregate?.metaVersusNonMeta,
              meanDimensionDeltas: comparisonAggregate?.meanDimensionDeltas,
            },
            null,
            2,
          )
        }}</pre>
      </template>
      <p v-else class="muted">
        No active-versus-draft comparison on this report (snapshot-only or incomplete replay).
      </p>
    </section>

    <section v-else-if="report && tab === 'ordering'" class="panel">
      <h2>Ordering and inversions</h2>
      <pre>{{ JSON.stringify(statistics?.monotonicOrdering ?? {}, null, 2) }}</pre>
      <h3>Outliers</h3>
      <pre>{{ JSON.stringify(statistics?.outliers ?? [], null, 2) }}</pre>
    </section>

    <section v-else-if="report && tab === 'dimensions'" class="panel">
      <h2>Dimensions</h2>
      <pre>{{ JSON.stringify(statistics?.dimensionSaturation ?? [], null, 2) }}</pre>
    </section>

    <section v-else-if="report && tab === 'slices'" class="panel">
      <h2>Role / class / meta slices</h2>
      <h3>Role</h3>
      <pre>{{ JSON.stringify(statistics?.roleSlices ?? [], null, 2) }}</pre>
      <h3>Class/spec</h3>
      <pre>{{ JSON.stringify(statistics?.classSpecSlices ?? [], null, 2) }}</pre>
      <h3>Meta vs non-meta</h3>
      <pre>{{ JSON.stringify(statistics?.metaVersusNonMeta ?? {}, null, 2) }}</pre>
    </section>

    <section v-else-if="report && tab === 'characters'" class="panel">
      <h2>Characters</h2>
      <p class="muted">
        Columns distinguish expert label vs observed grade vs observed score. Excluded/deferred members
        appear only when present in the frozen run.
      </p>
      <table class="table">
        <thead>
          <tr>
            <th>Identity</th>
            <th>Expert label</th>
            <th>Observed grade</th>
            <th>Observed score</th>
            <th>Confidence</th>
            <th>Error</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in characters" :key="String((row as any).memberId)">
            <td>
              {{ (row as any).region }}/{{ (row as any).realm }}/{{ (row as any).character }}
            </td>
            <td>{{ (row as any).expectedLabel }}</td>
            <td>{{ (row as any).grade ?? "—" }}</td>
            <td>{{ (row as any).overallScore ?? "—" }}</td>
            <td>{{ (row as any).confidence ?? "—" }}</td>
            <td>{{ (row as any).error ?? "—" }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section v-else-if="report && tab === 'coverage'" class="panel">
      <h2>Coverage and limitations</h2>
      <pre>{{ JSON.stringify(statistics?.confidenceVersusCoverage ?? [], null, 2) }}</pre>
      <pre>{{ JSON.stringify(report.limitations ?? [], null, 2) }}</pre>
    </section>

    <section v-else-if="report && tab === 'provenance'" class="panel">
      <h2>Provenance</h2>
      <ul>
        <li>Report schema {{ report.schemaVersion }}</li>
        <li>Digest algorithm {{ report.digestAlgorithmVersion }}</li>
        <li>Content hash {{ report.contentHash }}</li>
        <li>Generated {{ report.generatedAt }}</li>
        <li v-if="run">Input bundle hash {{ run.inputBundleContentHash }}</li>
        <li v-if="run">Evidence fingerprint {{ run.evidenceFingerprint }}</li>
        <li v-if="run">Snapshot IDs {{ run.snapshotIds.join(", ") || "—" }}</li>
      </ul>
      <details>
        <summary>Raw structured report</summary>
        <pre>{{ JSON.stringify(report.report, null, 2) }}</pre>
      </details>
    </section>
  </main>
</template>

<style scoped>
.admin-page {
  max-width: 1100px;
  margin: 0 auto;
  padding: 1.5rem;
  display: grid;
  gap: 1rem;
}
.tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}
.tabs button.active {
  font-weight: 700;
}
.panel {
  border-top: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
  padding-top: 1rem;
}
.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}
.table th,
.table td {
  border-bottom: 1px solid color-mix(in srgb, CanvasText 12%, transparent);
  text-align: left;
  padding: 0.35rem 0.4rem;
}
.muted {
  opacity: 0.75;
}
pre {
  overflow: auto;
  max-height: 28rem;
  font-size: 0.8rem;
}
</style>
