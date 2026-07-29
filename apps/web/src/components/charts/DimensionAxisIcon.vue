<script setup lang="ts">
import type { RadarDimension } from "../../lib/format";

const props = withDefaults(
  defineProps<{
    dimension: RadarDimension | "P" | "S" | "U" | "E";
    /**
     * `chart` (default): nested scale used by radar axis markers.
     * `fill`: draw full viewBox so CSS width/height centers the glyph (dimension cards).
     */
    layout?: "chart" | "fill";
  }>(),
  { layout: "chart" },
);

const short = (() => {
  const d = props.dimension;
  if (d === "P" || d === "S" || d === "U" || d === "E") return d;
  const map: Record<RadarDimension, "P" | "S" | "U" | "E" | "R"> = {
    PERFORMANCE: "P",
    SURVIVAL: "S",
    UTILITY: "U",
    EXPERIENCE: "E",
    RAID: "R",
  };
  return map[d];
})();

/** Chart markers keep the historical inset scale; fill layout uses the full 16×16 box. */
const glyphTransform = props.layout === "chart" ? "scale(0.625)" : undefined;
</script>

<template>
  <svg class="dim-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
    <!-- Performance: sword -->
    <g v-if="short === 'P'" :transform="glyphTransform">
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
    <!-- Survival: shield -->
    <path
      v-else-if="short === 'S'"
      d="M8 1.5 13 3.5v4.2c0 3.1-2.8 5.6-5 6.8-2.2-1.2-5-3.7-5-6.8V3.5z"
      :transform="glyphTransform"
      fill="none"
      stroke="currentColor"
      stroke-width="1.4"
      stroke-linejoin="round"
    />
    <!-- Utility: wrench -->
    <g v-else-if="short === 'U'" :transform="glyphTransform">
      <path
        d="M9.1 4.1a2.35 2.35 0 0 1 3.3 0 2.35 2.35 0 0 1 0 3.3l-1.15-1.15-1.4 1.4 1.15 1.15a2.35 2.35 0 0 1-3.3 0L4.2 12.3a1.2 1.2 0 0 1-1.7-1.7L7.7 5.4a2.35 2.35 0 0 1 1.4-1.3z"
        fill="none"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </g>
    <!-- Experience: bars -->
    <path
      v-else-if="short === 'E'"
      d="M3 12V6.5M6.5 12V4M10 12V7.5M13.5 12V5.5"
      :transform="glyphTransform"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
    />
    <!-- Raid (legacy): crossed blades -->
    <g v-else-if="short === 'R'" :transform="glyphTransform">
      <path
        d="M4 12.5 11.5 3.5M12 4.2l1.2 1.2M3.2 11.8l1.2 1.2M12.5 4 4 12.5M3.8 4.2 12.2 12.6M4.5 3.5 3.3 4.7M11.5 11.8l1.2 1.2"
        fill="none"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linecap="round"
      />
    </g>
  </svg>
</template>

<style scoped>
.dim-icon {
  display: block;
  flex-shrink: 0;
}
</style>
