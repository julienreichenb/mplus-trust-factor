<script setup lang="ts">
defineProps<{
  title: string;
  openByDefault?: boolean;
}>();
</script>

<template>
  <details class="collapse" :open="openByDefault" data-testid="collapsible-panel">
    <summary class="collapse__summary">
      <span class="collapse__title">{{ title }}</span>
      <span class="collapse__hint" aria-hidden="true">Toggle</span>
    </summary>
    <div class="collapse__body">
      <slot />
    </div>
  </details>
</template>

<style scoped>
.collapse {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  background: var(--color-surface);
  overflow: clip;
}

.collapse__summary {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-5);
  cursor: pointer;
  list-style: none;
  font-weight: 600;
}

.collapse__summary::-webkit-details-marker {
  display: none;
}

.collapse__hint {
  font-family: var(--font-data);
  font-size: var(--text-xs);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.collapse[open] .collapse__hint {
  color: var(--color-gold-300);
}

.collapse__body {
  padding: 0 var(--space-5) var(--space-5);
  border-top: 1px solid var(--color-border);
}
</style>
