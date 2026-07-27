<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import * as echarts from "echarts/core";
import { RadarChart } from "echarts/charts";
import { TooltipComponent, LegendComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { DimensionScoreDTO } from "@mplus/contracts";
import {
  DIMENSION_LABELS,
  RADAR_DIMENSIONS,
  type RadarDimension,
  formatPercent,
  formatScore,
  formatWeight,
} from "../../lib/format";

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
}>();

const emit = defineEmits<{
  "toggle-series": [id: string];
}>();

const el = ref<HTMLDivElement | null>(null);
let chart: echarts.ECharts | null = null;

const ordered = computed(() =>
  props.series.map((s) => ({
    ...s,
    visible: s.visible !== false,
    values: RADAR_DIMENSIONS.map((dim) => {
      const found = s.dimensions.find((d) => d.dimension === dim);
      return {
        dimension: dim,
        score: found?.score ?? 0,
        confidence: found?.confidence ?? 0,
        weight: found?.weight ?? 0,
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

function render(): void {
  if (!el.value || !canUseCanvas()) return;
  if (!chart) chart = echarts.init(el.value, undefined, { renderer: "canvas" });

  const visible = ordered.value.filter((s) => s.visible);
  chart.setOption(
    {
      color: ["#3ecf8e", "#5b8def", "#e6b84d", "#d6755b", "#9b7bff", "#5ec8d8"],
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
          return [
            `<strong>${params.seriesName}</strong>`,
            `${label}`,
            `Score: ${formatScore(point.score, 0)}`,
            `Confidence: ${formatPercent(point.confidence * 100, 0)}`,
            `Weight: ${formatWeight(point.weight)}`,
          ].join("<br/>");
        },
      },
      legend: { show: false },
      radar: {
        indicator: RADAR_DIMENSIONS.map((dim) => ({
          name: DIMENSION_LABELS[dim],
          max: 100,
          min: 0,
        })),
        axisName: { color: "#a8b0bf", fontSize: 11 },
        splitArea: {
          areaStyle: { color: ["#141923", "#181e2a"] },
        },
        axisLine: { lineStyle: { color: "#2c3548" } },
        splitLine: { lineStyle: { color: "#2c3548" } },
      },
      series: [
        {
          type: "radar",
          data: visible.map((s) => ({
            name: s.name,
            value: s.values.map((v) => v.score),
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
  <section class="radar-wrap" aria-labelledby="radar-title">
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
    <div ref="el" class="chart" role="img" :aria-label="title ?? 'Radar chart of trust dimensions'" />
    <table class="a11y-table" data-testid="radar-fallback">
      <caption>
        Textual equivalent of the radar chart (scores 0–100)
      </caption>
      <thead>
        <tr>
          <th scope="col">Candidate</th>
          <th v-for="dim in RADAR_DIMENSIONS" :key="dim" scope="col">
            {{ DIMENSION_LABELS[dim] }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="s in ordered.filter((x) => x.visible)" :key="s.id">
          <th scope="row">{{ s.name }}</th>
          <td v-for="v in s.values" :key="v.dimension">
            {{ formatScore(v.score, 0) }}
            <span class="sr-meta">(conf {{ formatPercent(v.confidence * 100, 0) }}, wt
              {{ formatWeight(v.weight) }})</span>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style scoped>
.radar-wrap {
  margin: 1rem 0 1.5rem;
}

.radar-head {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  justify-content: space-between;
  align-items: center;
}

.chart {
  width: 100%;
  height: min(380px, 70vw);
  min-height: 260px;
}

.toggles {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.toggle {
  display: inline-flex;
  gap: 0.35rem;
  align-items: center;
  font-size: 0.9rem;
}

.a11y-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
  margin-top: 0.75rem;
}

.a11y-table th,
.a11y-table td {
  border: 1px solid var(--border);
  padding: 0.4rem 0.5rem;
  text-align: left;
}

.a11y-table caption {
  text-align: left;
  padding: 0.35rem 0;
  color: var(--muted);
}

.sr-meta {
  display: block;
  color: var(--muted);
  font-size: 0.75rem;
}
</style>
