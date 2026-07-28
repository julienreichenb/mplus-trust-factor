<script setup lang="ts">
import { RouterLink } from "vue-router";
import type { CharacterProfileView } from "../../api/types";

defineProps<{
  profile: CharacterProfileView;
  refreshing?: boolean;
}>();

const emit = defineEmits<{
  refresh: [];
}>();
</script>

<template>
  <div class="toolbar" data-testid="character-toolbar">
    <RouterLink class="back" to="/#character-search">← Back to character search</RouterLink>
    <div class="toolbar__actions">
      <span class="refresh-state mpts-data" :data-status="profile.refreshStatus">{{
        profile.refreshStatus
      }}</span>
      <button
        type="button"
        class="btn secondary"
        data-testid="refresh-button"
        :disabled="refreshing || profile.refreshStatus === 'QUEUED'"
        @click="emit('refresh')"
      >
        {{ refreshing || profile.refreshStatus === "QUEUED" ? "Refreshing…" : "Refresh data" }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  justify-content: space-between;
  align-items: center;
}

.back {
  font-weight: 600;
  text-decoration: none;
  color: var(--color-gold-300);
}

.back:hover,
.back:focus-visible {
  color: var(--color-brand-hover);
  text-decoration: underline;
}

.toolbar__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  align-items: center;
}

.refresh-state {
  font-size: var(--text-xs);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  padding: 0.25rem 0.5rem;
}

.refresh-state[data-status="FRESH"] {
  color: var(--color-success-500);
  border-color: rgb(34 197 94 / 40%);
  background: rgb(34 197 94 / 10%);
}

.refresh-state[data-status="QUEUED"] {
  color: var(--color-amber-400);
  border-color: rgb(251 191 36 / 40%);
  background: rgb(251 191 36 / 10%);
}

.refresh-state[data-status="STALE"] {
  color: var(--color-danger-500);
  border-color: rgb(239 68 68 / 40%);
  background: rgb(239 68 68 / 10%);
}
</style>
