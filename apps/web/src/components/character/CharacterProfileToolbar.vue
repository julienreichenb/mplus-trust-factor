<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import type { CharacterProfileView } from "../../api/types";
import { presentStatusChip } from "../../lib/statusChip";
import { inferBootstrapRepairRequired } from "../../lib/bootstrapRepair";

const props = defineProps<{
  profile: CharacterProfileView;
  refreshing?: boolean;
  repairing?: boolean;
  /** When set, show a clear link to the admin character inspection page. */
  adminCharacterId?: string | null;
}>();

const emit = defineEmits<{
  refresh: [];
  repairBootstrap: [];
}>();

const bootstrapRepairRequired = computed(() => inferBootstrapRepairRequired(props.profile));

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

const busyStatus = computed(() => {
  if (showQueued.value && !isUpdating.value) return "QUEUED";
  if (isUpdating.value || refreshInFlight.value) return "REFRESHING";
  return null;
});

const refreshButtonLabel = computed(() => {
  if (!busyStatus.value) return "Refresh data";
  return presentStatusChip(busyStatus.value).label;
});

const refreshButtonTestId = computed(() => {
  if (showQueued.value && !isUpdating.value) return "refresh-status-queued";
  if (isUpdating.value || refreshInFlight.value) return "refresh-status-updating";
  return "refresh-button";
});

const showRepairAction = computed(
  () => bootstrapRepairRequired.value && !refreshInFlight.value,
);

const showAdminCharacterLink = computed(
  () => Boolean(props.adminCharacterId && String(props.adminCharacterId).trim()),
);
</script>

<template>
  <div class="toolbar" data-testid="character-toolbar">
    <RouterLink class="back" to="/#character-search">← Back to character search</RouterLink>
    <div class="toolbar__actions">
      <RouterLink
        v-if="showAdminCharacterLink"
        class="btn secondary admin-character-link"
        data-testid="admin-character-link"
        :to="{ name: 'admin-character', params: { characterId: adminCharacterId } }"
      >
        Admin character detail
      </RouterLink>
      <button
        v-if="showRepairAction"
        type="button"
        class="btn secondary"
        data-testid="bootstrap-repair-button"
        :disabled="repairing"
        :aria-busy="repairing ? 'true' : 'false'"
        @click="emit('repairBootstrap')"
      >
        Retry Blizzard profile lookup
      </button>
      <button
        type="button"
        class="btn secondary refresh-btn"
        :class="{ 'refresh-btn--busy': refreshInFlight }"
        :data-testid="refreshButtonTestId"
        :disabled="refreshInFlight || showRepairAction"
        :aria-busy="refreshInFlight ? 'true' : 'false'"
        @click="emit('refresh')"
      >
        <span
          v-if="refreshInFlight"
          class="refresh-btn__spinner"
          data-testid="refresh-button-spinner"
          aria-hidden="true"
        />
        {{ refreshButtonLabel }}
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

.admin-character-link {
  text-decoration: none;
  font-weight: 650;
}

.refresh-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}

.refresh-btn--busy {
  color: #fde68a;
  background: rgb(245 158 11 / 18%);
  border-color: rgb(245 158 11 / 48%);
  cursor: not-allowed;
  opacity: 1;
}

.refresh-btn--busy:disabled {
  opacity: 1;
}

.refresh-btn__spinner {
  width: 0.75rem;
  height: 0.75rem;
  flex-shrink: 0;
  border: 1.5px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: refresh-btn-spin 0.75s linear infinite;
}

@keyframes refresh-btn-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .refresh-btn__spinner {
    animation: none;
    border-right-color: currentColor;
    opacity: 0.55;
  }
}
</style>
