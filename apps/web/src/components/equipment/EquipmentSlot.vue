<script setup lang="ts">
defineProps<{
  slotView: {
    id: string;
    label: string;
    name: string | null;
    itemLevel: number | null;
    filled: boolean;
  };
}>();
</script>

<template>
  <li class="slot" :data-filled="slotView.filled ? 'true' : 'false'" :data-slot="slotView.id">
    <span class="slot__icon" aria-hidden="true" />
    <span class="slot__body">
      <span class="slot__label">{{ slotView.label }}</span>
      <span v-if="slotView.filled" class="slot__name">{{ slotView.name }}</span>
      <span v-else class="slot__empty">Unavailable</span>
      <span v-if="slotView.itemLevel != null" class="slot__ilvl mpts-data">ilvl {{ slotView.itemLevel }}</span>
    </span>
  </li>
</template>

<style scoped>
.slot {
  display: grid;
  grid-template-columns: 2.5rem 1fr;
  gap: var(--space-3);
  align-items: center;
  min-height: 3.25rem;
  padding: var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  background: var(--color-obsidian-900);
}

.slot[data-filled="false"] {
  border-style: dashed;
  background: transparent;
}

.slot__icon {
  width: 2.5rem;
  height: 2.5rem;
  border-radius: var(--radius-control);
  border: 1px solid var(--color-border);
  background:
    linear-gradient(145deg, rgb(244 213 141 / 12%), transparent 55%),
    var(--color-iron-800);
}

.slot[data-filled="false"] .slot__icon {
  border-style: dashed;
  background: var(--color-iron-850);
}

.slot__body {
  display: grid;
  gap: 0.1rem;
  min-width: 0;
}

.slot__label {
  font-family: var(--font-data);
  font-size: var(--text-xs);
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.slot__name {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-text);
  overflow-wrap: anywhere;
}

.slot__empty,
.slot__ilvl {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}
</style>
