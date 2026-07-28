<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import * as echarts from "echarts/core";
import { RadarChart } from "echarts/charts";
import { TooltipComponent, LegendComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { DimensionScoreDTO } from "@mplus/contracts";
import {
  DIMENSION_LABELS,
  resolveRadarDimensions,
  type RadarDimension,
  formatPercent,
  formatScore,
  formatWeight,
} from "../../lib/format";
import TrustDimensionTable from "../score/TrustDimensionTable.vue";

echarts.use([RadarChart, TooltipComponent, LegendComponent, CanvasRenderer]);

export interface RadarSeries {
  id: string;
  name: string;
  dimensions: DimensionScoreDTO[];
  visible?: boolean;
}

const props = defineProps<{
  series: RadarSeries[];
  title?: string;
  locked?: boolean;
  modelVersion?: number | null;
}>();

const emit = defineEmits<{
  "toggle-series": [id: string];
}>();

const el = ref<HTMLDivElement | null>(null);
let chart: echarts.ECharts | null = null;

const primaryDimensions = computed(() => props.series[0]?.dimensions ?? []);

const radarDimensions = computed(() => resolveRadarDimensions(props.modelVersion));

const ordered = computed(() =>
  props.series.map((s) => ({
    ...s,
    visible: s.visible !== false,
    values: radarDimensions.value.map((dim) => {
      const found = s.dimensions.find((d) => d.dimension === dim);
      const state = found?.state;
      const unavailable =
        !found ||
        found.score == null ||
        found.confidence <= 0 ||
        state === "UNAVAILABLE" ||
        state === "PROCESSING" ||
        state === "ERROR";
      return {
        dimension: dim,
        score: unavailable ? null : found!.score,
        confidence: unavailable ? null : found!.confidence,
        weight: found?.weight ?? null,
        missing: unavailable,
        state: state ?? (unavailable ? "UNAVAILABLE" : "AVAILABLE"),
      };
    }),
  })),
);

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

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function render(): void {
  if (!el.value || !canUseCanvas()) return;
  if (!chart) chart = echarts.init(el.value, undefined, { renderer: "canvas" });

  const visible = ordered.value.filter((s) => s.visible);
  chart.setOption(
    {
      animation: !prefersReducedMotion(),
      color: ["#F59E0B", "#38BDF8", "#A3E635", "#A78BFA", "#FB7185", "#F4D58D"],
      tooltip: {
        trigger: "item",
        formatter: (params: {
          seriesName?: string;
          name?: string;
          value?: number;
          dataIndex?: number;
        }) => {
          const series = visible.find((s) => s.name === params.seriesName);
          const idx = params.dataIndex ?? 0;
          const point = series?.values[idx];
          if (!point) return "";
          const label = DIMENSION_LABELS[point.dimension as RadarDimension];
          if (point.missing) {
            return [`<strong>${params.seriesName}</strong>`, label, "Unavailable"].join("<br/>");
          }
          return [
            `<strong>${params.seriesName}</strong>`,
            `${label}`,
            `Score: ${formatScore(point.score, 0)}`,
            `Confidence: ${formatPercent((point.confidence ?? 0) * 100, 0)}`,
            `Weight: ${formatWeight(point.weight)}`,
          ].join("<br/>");
        },
      },
      legend: { show: false },
      radar: {
        indicator: radarDimensions.value.map((dim) => ({
          name: DIMENSION_LABELS[dim],
          max: 100,
          min: 0,
        })),
        axisName: {
          color: "#C8BDA8",
          fontSize: 11,
          overflow: "break",
          width: 72,
        },
        splitArea: {
          areaStyle: { color: ["rgba(23,23,25,0.35)", "rgba(32,32,36,0.55)"] },
        },
        axisLine: { lineStyle: { color: "#34343A" } },
        splitLine: { lineStyle: { color: "#34343A" } },
        center: ["50%", "52%"],
        radius: "62%",
      },
      series: [
        {
          type: "radar",
          areaStyle: { opacity: 0.14 },
          data: visible.map((s) => ({
            name: s.name,
            value: s.values.map((v) => (v.missing ? 0 : (v.score ?? 0))),
          })),
        },
      ],
    },
    true,
  );
}

function onResize(): void {
  chart?.resize();
}

onMounted(() => {
  render();
  window.addEventListener("resize", onResize);
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", onResize);
  chart?.dispose();
  chart = null;
});

watch(
  () => props.series,
  () => render(),
  { deep: true },
);
</script>

<template>
  <section class="radar-wrap" aria-labelledby="radar-title" data-testid="trust-dimension-radar">
    <div class="radar-head">
      <h2 id="radar-title">{{ title ?? "Trust dimensions" }}</h2>
      <div v-if="series.length > 1" class="toggles" role="group" aria-label="Toggle comparison series">
        <label v-for="s in ordered" :key="s.id" class="toggle">
          <input
            type="checkbox"
            :checked="s.visible"
            @change="emit('toggle-series', s.id)"
          />
          {{ s.name }}
        </label>
      </div>
    </div>

    <div class="radar-layout">
      <div
        ref="el"
        class="chart"
        role="img"
        :aria-label="title ?? 'Radar chart of trust dimensions'"
      />
      <TrustDimensionTable
        :dimensions="primaryDimensions"
        :model-version="modelVersion"
        :locked="locked"
      />
    </div>

    <table class="a11y-table" data-testid="radar-fallback">
      <caption>
        Textual equivalent of the radar chart (scores 0–100). Missing dimensions are marked explicitly.
      </caption>
      <thead>
        <tr>
          <th scope="col">Candidate</th>
          <th v-for="dim in radarDimensions" :key="dim" scope="col">
            {{ DIMENSION_LABELS[dim] }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="s in ordered.filter((x) => x.visible)" :key="s.id">
          <th scope="row">{{ s.name }}</th>
          <td v-for="v in s.values" :key="v.dimension">
            <template v-if="v.missing">Missing</template>
            <template v-else>
              {{ formatScore(v.score, 0) }}
              <span class="sr-meta"
                >(conf {{ formatPercent((v.confidence ?? 0) * 100, 0) }}, wt
                {{ formatWeight(v.weight) }})</span
              >
            </template>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style scoped>
.radar-wrap {
  display: grid;
  gap: var(--space-4);
  margin: 0;
}

.radar-head {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  justify-content: space-between;
  align-items: center;
}

.radar-head h2 {
  margin: 0;
}

.radar-layout {
  display: grid;
  gap: var(--space-4);
}

.chart {
  width: 100%;
  height: min(380px, 70vw);
  min-height: 260px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  background: var(--color-surface);
}

.toggles {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}

.toggle {
  display: inline-flex;
  gap: var(--space-2);
  align-items: center;
  font-size: var(--text-sm);
}

.a11y-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
}

.a11y-table th,
.a11y-table td {
  border: 1px solid var(--color-border);
  padding: 0.4rem 0.5rem;
  text-align: left;
}

.a11y-table caption {
  text-align: left;
  padding: 0.35rem 0;
  color: var(--color-text-muted);
}

.sr-meta {
  display: block;
  color: var(--color-text-muted);
  font-size: var(--text-xs);
}

@media (min-width: 900px) {
  .radar-layout {
    grid-template-columns: minmax(16rem, 0.9fr) minmax(0, 1.1fr);
    align-items: center;
  }
}
</style>
