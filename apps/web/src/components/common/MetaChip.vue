<script setup lang="ts">
withDefaults(
  defineProps<{
    label: string;
    value: string;
    /** Prefer `data` for monospace numeric/model values. */
    valueClass?: string;
  }>(),
  {
    valueClass: undefined,
  },
);
</script>

<template>
  <span class="meta-chip" :aria-label="`${label}: ${value}`">
    <span class="meta-chip__label">{{ label }}</span>
    <span class="meta-chip__value" :class="valueClass">{{ value }}</span>
  </span>
</template>

<style scoped>
.meta-chip {
  display: inline-flex;
  align-items: baseline;
  gap: var(--space-2);
  max-width: 100%;
  padding: 0.35rem 0.65rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  background: rgb(255 255 255 / 3%);
  line-height: 1.2;
}

.meta-chip__label {
  font-family: var(--font-data);
  font-size: var(--text-xs);
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  white-space: nowrap;
}

.meta-chip__value {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-text);
  overflow-wrap: anywhere;
}
</style>
