<script setup lang="ts">
import { computed } from "vue";
import type { Grade } from "../../api/types";
import { presentGrade } from "../../lib/characterViewModel";

/** Flat-top hexagon in a 100×100 viewBox. */
const HEX_POINTS = "50,1.5 93.5,26.5 93.5,73.5 50,98.5 6.5,73.5 6.5,26.5";

const props = withDefaults(
  defineProps<{
    tier?: Grade | null;
    /** Glyph footprint. `display` is the landing hero size. */
    size?: "sm" | "md" | "lg" | "xl" | "display";
    /** `panel` = filled plate; `ghost` = letter only (no plate fill/border). */
    surface?: "panel" | "ghost";
  }>(),
  {
    tier: null,
    size: "md",
    surface: "panel",
  },
);

const presentation = computed(() => presentGrade(props.tier));

const rootClass = computed(() => [
  "tier-grade-letter",
  `tier-grade-letter--${props.size}`,
  `tier-grade-letter--${props.surface}`,
  presentation.value.letter ? `tier-grade-letter--${presentation.value.letter}` : "tier-grade-letter--none",
]);
</script>

<template>
  <span :class="rootClass" aria-hidden="true">
    <svg
      v-if="surface === 'panel'"
      class="tier-grade-letter__ring"
      viewBox="0 0 100 100"
      focusable="false"
    >
      <polygon class="tier-grade-letter__fill" :points="HEX_POINTS" />
      <polygon
        class="tier-grade-letter__stroke"
        :class="{ 'tier-grade-letter__stroke--dotted': presentation.isUnrated }"
        :points="HEX_POINTS"
      />
    </svg>
    <span class="tier-grade-letter__glyph">{{ presentation.letter ?? "—" }}</span>
  </span>
</template>
