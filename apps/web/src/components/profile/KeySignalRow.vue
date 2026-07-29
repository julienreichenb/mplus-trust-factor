<script setup lang="ts">
import type { ContributorSignal } from "../../lib/characterViewModel";
import DimensionAxisIcon from "../charts/DimensionAxisIcon.vue";

defineProps<{
  signal: ContributorSignal;
  /** Hide dimension subtitle when already scoped to a dimension card. */
  hideDimension?: boolean;
}>();
</script>

<template>
  <li
    class="signal-row"
    :class="{ 'signal-row--compact': hideDimension }"
    :data-kind="signal.kind"
  >
    <span v-if="!hideDimension" class="signal-row__icon" aria-hidden="true">
      <DimensionAxisIcon v-if="signal.dimensionKey" :dimension="signal.dimensionKey" />
    </span>
    <div class="signal-row__body">
      <p class="signal-row__label">{{ signal.label }}</p>
      <p v-if="signal.dimension && !hideDimension" class="signal-row__dimension">{{ signal.dimension }}</p>
    </div>
  </li>
</template>

<style scoped>
.signal-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--space-2);
  align-items: start;
  padding: 0.35rem 0 0.35rem var(--space-2);
  border-left: 3px solid transparent;
  list-style: none;
}

.signal-row--compact {
  grid-template-columns: minmax(0, 1fr);
}

.signal-row[data-kind="positive"] {
  border-left-color: var(--color-success-500);
}

.signal-row[data-kind="risk"] {
  border-left-color: var(--color-danger-500);
}

.signal-row__icon {
  display: grid;
  place-items: center;
  width: 1.75rem;
  height: 1.75rem;
  margin-top: 0.05rem;
  color: var(--color-text-muted);
}

.signal-row__icon :deep(.dim-icon) {
  width: 1.55rem;
  height: 1.55rem;
}

.signal-row[data-kind="positive"] .signal-row__icon {
  color: var(--color-success-500);
}

.signal-row[data-kind="risk"] .signal-row__icon {
  color: var(--color-danger-500);
}

.signal-row__body {
  display: grid;
  gap: 0.15rem;
  min-width: 0;
}

.signal-row__label {
  margin: 0;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-text);
  line-height: 1.35;
}

.signal-row__dimension {
  margin: 0;
  font-family: var(--font-data);
  font-size: var(--text-xs);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}
</style>
