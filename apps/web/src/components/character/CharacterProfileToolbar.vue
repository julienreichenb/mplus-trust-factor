<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import type { CharacterProfileView } from "../../api/types";

const props = defineProps<{
  profile: CharacterProfileView;
  refreshing?: boolean;
  canForceRefresh?: boolean;
}>();

const emit = defineEmits<{
  refresh: [];
  forceRefresh: [];
}>();

const refreshInFlight = computed(
  () =>
    Boolean(props.refreshing) ||
    props.profile.refreshStatus === "QUEUED" ||
    props.profile.refreshStatus === "REFRESHING",
);

const isUpdating = computed(
  () =>
    props.profile.refreshStatus === "REFRESHING" ||
    (Boolean(props.refreshing) && props.profile.refreshStatus !== "QUEUED"),
);

const showQueued = computed(() => props.profile.refreshStatus === "QUEUED");
</script>

<template>
  <div class="toolbar" data-testid="character-toolbar">
    <RouterLink class="back" to="/#character-search">← Back to character search</RouterLink>
    <div class="toolbar__actions">
      <span
        v-if="showQueued && !isUpdating"
        class="refresh-state refresh-state--queued mpts-data"
        data-status="QUEUED"
        data-testid="refresh-status-queued"
      >
        QUEUED
      </span>
      <span
        v-else-if="isUpdating || refreshInFlight"
        class="refresh-state refresh-state--updating mpts-data"
        data-status="REFRESHING"
        data-testid="refresh-status-updating"
      >
        <span class="refresh-spinner" aria-hidden="true" />
        Updating profile
      </span>
      <span
        v-else
        class="refresh-state mpts-data"
        :data-status="profile.refreshStatus"
      >
        {{ profile.refreshStatus === "STALE" ? "Needs refresh" : profile.refreshStatus }}
      </span>
      <button
        type="button"
        class="btn secondary"
        data-testid="refresh-button"
        :disabled="refreshInFlight"
        @click="emit('refresh')"
      >
        {{ refreshInFlight ? "Refreshing…" : "Refresh data" }}
      </button>
      <button
        v-if="canForceRefresh"
        type="button"
        class="btn secondary"
        data-testid="force-refresh-button"
        :disabled="refreshInFlight"
        @click="emit('forceRefresh')"
      >
        Force refresh
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
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
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

.refresh-state--queued,
.refresh-state[data-status="QUEUED"] {
  color: var(--color-amber-400);
  border-color: rgb(251 191 36 / 40%);
  background: rgb(251 191 36 / 10%);
}

.refresh-state--updating,
.refresh-state[data-status="REFRESHING"] {
  color: var(--color-amber-400);
  border-color: rgb(251 191 36 / 40%);
  background: rgb(251 191 36 / 10%);
}

.refresh-state[data-status="STALE"] {
  color: var(--color-danger-500);
  border-color: rgb(239 68 68 / 40%);
  background: rgb(239 68 68 / 10%);
}

.refresh-spinner {
  width: 0.7rem;
  height: 0.7rem;
  border: 1.5px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: refresh-spin 0.7s linear infinite;
}

@keyframes refresh-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
