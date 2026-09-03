<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { CharacterIdentityInput, ScoreSnapshotDTO } from "@mplus/contracts";
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { formatScore } from "../../lib/format";
import {
  buildScoreHistoryChartOption,
  formatHistoryDateTime,
  mapScoreHistoryPoints,
  seasonLabel,
} from "../../lib/scoreHistoryChart";
import ProfileFold from "./ProfileFold.vue";

echarts.use([
  LineChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkAreaComponent,
  CanvasRenderer,
]);

const props = defineProps<{
  identity: CharacterIdentityInput;
  /** Published score timestamp — refetch history when this changes after background refresh. */
  scoreCalculatedAt?: string | null;
  limit?: number;
}>();

const loading = ref(false);
const error = ref<string | null>(null);
const fetchedSnapshots = ref<ScoreSnapshotDTO[]>([]);
const chartEl = ref<HTMLDivElement | null>(null);

let requestEpoch = 0;
let abortController: AbortController | null = null;
let mounted = true;
let chart: echarts.ECharts | null = null;
let resizeObserver: ResizeObserver | null = null;

const points = computed(() => mapScoreHistoryPoints(fetchedSnapshots.value));

const snapshotCountLabel = computed(() => {
  const n = points.value.length;
  if (n === 0) return "";
  return `${n} snapshot${n === 1 ? "" : "s"}`;
});

function canUseCanvas(): boolean {
  if (import.meta.env.MODE === "test") return false;
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    return typeof canvas.getContext === "function" && canvas.getContext("2d") != null;
  } catch {
    return false;
  }
}

function renderChart(): void {
  if (!chartEl.value || !canUseCanvas() || points.value.length === 0) return;
  if (!chart) chart = echarts.init(chartEl.value, undefined, { renderer: "canvas" });
  chart.setOption(buildScoreHistoryChartOption(points.value), true);
}

function onResize(): void {
  chart?.resize();
}

async function loadHistory(): Promise<void> {
  const epoch = ++requestEpoch;
  abortController?.abort();
  const controller = new AbortController();
  abortController = controller;

  loading.value = true;
  error.value = null;
  try {
    const apiBase = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";
    const { region, realmSlug, name } = props.identity;
    const limit = props.limit ?? 50;
    const url = `/api/v1/characters/${encodeURIComponent(region)}/${encodeURIComponent(realmSlug)}/${encodeURIComponent(name)}/history?limit=${encodeURIComponent(
      String(limit),
    )}`;
    const res = await fetch(`${apiBase}${url}`, {
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!mounted || epoch !== requestEpoch) return;
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      throw new Error(body?.error?.message ?? `Score history request failed (${res.status})`);
    }
    const body = (await res.json()) as { snapshots?: ScoreSnapshotDTO[] | null };
    if (!mounted || epoch !== requestEpoch) return;
    fetchedSnapshots.value = Array.isArray(body.snapshots) ? body.snapshots : [];
  } catch (err) {
    if (!mounted || epoch !== requestEpoch) return;
    if (err instanceof DOMException && err.name === "AbortError") return;
    error.value = err instanceof Error ? err.message : "Score history unavailable";
    fetchedSnapshots.value = [];
  } finally {
    if (mounted && epoch === requestEpoch) {
      loading.value = false;
    }
  }
}

watch(
  () =>
    [
      props.identity.region,
      props.identity.realmSlug,
      props.identity.name,
      props.scoreCalculatedAt ?? null,
    ] as const,
  () => {
    void loadHistory();
  },
  { immediate: true },
);

watch(points, () => renderChart(), { deep: true });

onMounted(() => {
  renderChart();
  window.addEventListener("resize", onResize);
  if (chartEl.value && typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => onResize());
    resizeObserver.observe(chartEl.value);
  }
});

onBeforeUnmount(() => {
  mounted = false;
  requestEpoch += 1;
  abortController?.abort();
  abortController = null;
  window.removeEventListener("resize", onResize);
  resizeObserver?.disconnect();
  resizeObserver = null;
  chart?.dispose();
  chart = null;
});
</script>

<template>
  <ProfileFold title="Score history" title-id="score-history-title" test-id="score-history-section">
    <template v-if="snapshotCountLabel" #meta>
      <span class="profile-fold__tag mpts-data">{{ snapshotCountLabel }}</span>
    </template>

    <div class="score-history__panel">
      <p v-if="loading" class="muted">Loading…</p>
      <p v-else-if="error" class="muted" role="status" aria-live="polite">
        {{ error }}
      </p>
      <p v-else-if="points.length === 0" class="muted">
        No score history available.
      </p>

      <div v-else class="score-history__chart">
        <div
          ref="chartEl"
          class="score-history__echarts"
          data-testid="score-history-chart"
          role="img"
          aria-label="Line chart of Trust Score history from 0 to 100"
        />

        <table class="sr-only" data-testid="score-history-table">
          <caption>Textual equivalent of Trust Score history (0–100)</caption>
          <thead>
            <tr>
              <th scope="col">Calculated</th>
              <th scope="col">Season</th>
              <th scope="col">Trust Score</th>
              <th scope="col">Raw score</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in points" :key="p.id">
              <th scope="row">{{ formatHistoryDateTime(p.calculatedAt) }}</th>
              <td>{{ seasonLabel(p.seasonSlug) }}</td>
              <td>{{ p.adjusted != null ? formatScore(p.adjusted, 1) : "Unavailable" }}</td>
              <td>{{ p.raw != null ? formatScore(p.raw, 1) : "Unavailable" }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </ProfileFold>
</template>

<style scoped>
.score-history__panel {
  display: grid;
  gap: var(--space-3);
}

.muted {
  margin: 0;
  color: var(--color-text-muted);
}

.score-history__chart {
  min-width: 0;
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  background: var(--color-surface);
}

.score-history__echarts {
  width: 100%;
  height: 16rem;
}
</style>
