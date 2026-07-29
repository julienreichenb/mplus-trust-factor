<script setup lang="ts">
import type { Grade } from "../../api/types";
import { presentGrade } from "../../lib/characterViewModel";
import TierGradeLetter from "../brand/TierGradeLetter.vue";

export interface HeroTrustPreview {
  grade: Grade;
  dimensions: { short: string; value: number }[];
}

const props = defineProps<{
  preview: HeroTrustPreview;
}>();

const presentation = presentGrade(props.preview.grade);
const dimensionCount = props.preview.dimensions.length;

function polarPoint(index: number, radius: number): { x: number; y: number } {
  const angle = -Math.PI / 2 + (index / dimensionCount) * Math.PI * 2;
  return {
    x: 50 + Math.cos(angle) * radius,
    y: 50 + Math.sin(angle) * radius,
  };
}

function radarRadius(value: number): number {
  const normalized = Math.max(0, Math.min(100, value)) / 100;
  return 5 + Math.pow(normalized, 1.45) * 32;
}

function radarPoint(index: number, value: number): string {
  const { x, y } = polarPoint(index, radarRadius(value));
  return `${x.toFixed(1)},${y.toFixed(1)}`;
}

const radarPolygon = props.preview.dimensions
  .map((d, i) => radarPoint(i, d.value))
  .join(" ");

const radarRing = props.preview.dimensions
  .map((_, i) => radarPoint(i, 100))
  .join(" ");

const axisLabels = props.preview.dimensions.map((d, i) => {
  const { x, y } = polarPoint(i, 40);
  return { short: d.short, x, y };
});

const dimensionTitles: Record<string, string> = {
  P: "Performance",
  S: "Survival",
  U: "Utility",
  E: "Experience",
};
</script>

<template>
  <div
    class="hero-trust"
    :data-tier="preview.grade"
    :aria-label="`${presentation.interpretation}, grade ${preview.grade}`"
  >
    <p class="hero-trust__title">{{ presentation.interpretation }}</p>
    <TierGradeLetter :tier="preview.grade" size="display" />

    <svg
      class="hero-trust__radar"
      viewBox="0 0 100 100"
      role="presentation"
      aria-hidden="true"
    >
      <polygon class="hero-trust__radar-ring" :points="radarRing" />
      <polygon
        class="hero-trust__radar-fill"
        :points="radarPolygon"
        :data-grade="preview.grade"
      />
      <g
        v-for="label in axisLabels"
        :key="label.short"
        class="hero-trust__axis-icon"
        :transform="`translate(${label.x - 5}, ${label.y - 5})`"
      >
        <title>{{ dimensionTitles[label.short] ?? label.short }}</title>
        <!-- Performance: sword -->
        <g v-if="label.short === 'P'" transform="scale(0.625)">
          <path
            d="M8 2v7.5M5.2 9.2h5.6M8 9.5v3.2"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <circle cx="8" cy="13.8" r="1.05" fill="currentColor" />
          <path
            d="M7.15 2.9 8 1.55 8.85 2.9"
            fill="none"
            stroke="currentColor"
            stroke-width="1.35"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </g>
        <path
          v-else-if="label.short === 'S'"
          d="M8 1.5 13 3.5v4.2c0 3.1-2.8 5.6-5 6.8-2.2-1.2-5-3.7-5-6.8V3.5z"
          transform="scale(0.625)"
          fill="none"
          stroke="currentColor"
          stroke-width="1.4"
          stroke-linejoin="round"
        />
        <g v-else-if="label.short === 'U'" transform="scale(0.625)">
          <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.4" />
          <path
            d="M8 5v6M5 8h6"
            fill="none"
            stroke="currentColor"
            stroke-width="1.4"
            stroke-linecap="round"
          />
        </g>
        <path
          v-else-if="label.short === 'E'"
          d="M3 12V6.5M6.5 12V4M10 12V7.5M13.5 12V5.5"
          transform="scale(0.625)"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
        />
      </g>
    </svg>
  </div>
</template>

<style scoped>
.hero-trust {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.35rem;
  width: 100%;
  height: 100%;
  min-height: 0;
}

.hero-trust__title {
  margin: 0;
  font-family: var(--font-data);
  font-size: var(--text-sm);
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  line-height: 1.15;
  max-width: 14rem;
  text-align: right;
}

.hero-trust__radar {
  display: block;
  width: 100%;
  height: auto;
  aspect-ratio: 1;
  margin-top: auto;
  max-width: 16rem;
  align-self: stretch;
}

.hero-trust__radar-ring {
  fill: none;
  stroke: rgb(255 255 255 / 12%);
  stroke-width: 1;
}

.hero-trust__radar-fill {
  fill: rgb(245 158 11 / 22%);
  stroke: var(--color-amber-400);
  stroke-width: 1.5;
}

.hero-trust__radar-fill[data-grade="S"] {
  fill: rgb(56 189 248 / 18%);
  stroke: var(--color-tier-s);
}

.hero-trust__radar-fill[data-grade="U"] {
  fill: rgb(244 213 141 / 24%);
  stroke: var(--color-tier-u);
}

.hero-trust__radar-fill[data-grade="A"] {
  fill: rgb(163 230 53 / 18%);
  stroke: var(--color-tier-a);
}

.hero-trust__radar-fill[data-grade="B"] {
  fill: rgb(45 212 191 / 18%);
  stroke: var(--color-tier-b);
}

.hero-trust__radar-fill[data-grade="D"] {
  fill: rgb(251 113 133 / 16%);
  stroke: var(--color-tier-d);
}

.hero-trust__axis-icon {
  color: var(--color-text-muted);
}
</style>
