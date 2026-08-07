<script setup lang="ts">
import type { CalibrationExpectedRank } from "@mplus/contracts";

const props = withDefaults(
  defineProps<{
    modelValue: CalibrationExpectedRank;
    disabled?: boolean;
    size?: "sm" | "md";
  }>(),
  { disabled: false, size: "md" },
);

const emit = defineEmits<{ "update:modelValue": [value: CalibrationExpectedRank] }>();

const ranks: CalibrationExpectedRank[] = ["S", "A", "B", "C", "D"];

function select(rank: CalibrationExpectedRank): void {
  if (props.disabled) return;
  emit("update:modelValue", rank);
}
</script>

<template>
  <div
    class="rank-selector"
    :class="[`rank-selector--${size}`, { 'rank-selector--disabled': disabled }]"
    role="radiogroup"
    aria-label="Expected rank"
    data-testid="calibration-rank-selector"
  >
    <button
      v-for="rank in ranks"
      :key="rank"
      type="button"
      class="rank-selector__btn"
      :class="{ 'is-active': modelValue === rank }"
      role="radio"
      :aria-checked="modelValue === rank"
      :disabled="disabled"
      :data-testid="`rank-${rank}`"
      @click="select(rank)"
    >
      {{ rank }}
    </button>
  </div>
</template>

<style scoped>
.rank-selector {
  display: inline-flex;
  gap: 0.25rem;
  padding: 0.2rem;
  border-radius: var(--radius-control);
  border: 1px solid var(--color-border);
  background: rgb(0 0 0 / 18%);
}

.rank-selector__btn {
  min-width: 2rem;
  padding: 0.35rem 0.55rem;
  border: 0;
  border-radius: calc(var(--radius-control) - 2px);
  background: transparent;
  color: var(--color-text-muted);
  font-family: var(--font-data);
  font-weight: 700;
  font-size: var(--text-sm);
  cursor: pointer;
}

.rank-selector--sm .rank-selector__btn {
  min-width: 1.65rem;
  padding: 0.2rem 0.4rem;
  font-size: var(--text-xs);
}

.rank-selector__btn:hover:not(:disabled) {
  color: var(--color-text);
  background: var(--color-surface-hover);
}

.rank-selector__btn.is-active {
  background: var(--color-amber-400);
  color: #111;
}

.rank-selector--disabled {
  opacity: 0.55;
}

.rank-selector__btn:disabled {
  cursor: not-allowed;
}

.rank-selector__btn:focus-visible {
  outline: 2px solid var(--color-amber-400);
  outline-offset: 1px;
}
</style>
