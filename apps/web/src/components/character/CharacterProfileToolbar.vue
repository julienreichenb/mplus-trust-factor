<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import type { CharacterProfileView } from "../../api/types";
import StatusChip from "./StatusChip.vue";

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

const chipStatus = computed(() => {
  if (showQueued.value && !isUpdating.value) return "QUEUED";
  if (isUpdating.value || refreshInFlight.value) return "REFRESHING";
  return props.profile.refreshStatus;
});

const chipTestId = computed(() => {
  if (showQueued.value && !isUpdating.value) return "refresh-status-queued";
  if (isUpdating.value || refreshInFlight.value) return "refresh-status-updating";
  return "refresh-status-idle";
});
</script>

<template>
  <div class="toolbar" data-testid="character-toolbar">
    <RouterLink class="back" to="/#character-search">← Back to character search</RouterLink>
    <div class="toolbar__actions">
      <StatusChip :status="chipStatus" :data-testid="chipTestId" />
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
</style>
