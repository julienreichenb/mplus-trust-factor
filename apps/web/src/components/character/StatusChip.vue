<script setup lang="ts">
import { computed } from "vue";
import { presentStatusChip, type StatusChipTone } from "../../lib/statusChip";

const BUSY_STATUSES = new Set(["QUEUED", "RUNNING", "REFRESHING", "DISCOVERING", "ACTIVE"]);

const props = withDefaults(
  defineProps<{
    status?: string | null;
    /** Override visible label; defaults from status mapping. */
    label?: string | null;
    tone?: StatusChipTone | null;
    /** Force spinner; defaults from busy statuses. */
    busy?: boolean | null;
  }>(),
  {
    status: null,
    label: null,
    tone: null,
    busy: null,
  },
);

const presentation = computed(() => {
  const mapped = presentStatusChip(props.status);
  return {
    label: props.label?.trim() || mapped.label,
    tone: props.tone ?? mapped.tone,
  };
});

const showSpinner = computed(() => {
  if (props.busy != null) return props.busy;
  const key = (props.status ?? "").trim().toUpperCase().replace(/\s+/g, "_");
  return BUSY_STATUSES.has(key);
});
</script>

<template>
  <span
    class="status-chip mpts-data"
    :data-tone="presentation.tone"
    :data-status="status ?? undefined"
    :data-busy="showSpinner ? 'true' : undefined"
  >
    <span
      v-if="showSpinner"
      class="status-chip__spinner"
      data-testid="status-chip-spinner"
      aria-hidden="true"
    />
    {{ presentation.label }}
  </span>
</template>

<style scoped>
.status-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  width: fit-content;
  max-width: 100%;
  padding: 0.12rem 0.45rem;
  border-radius: 0.3rem;
  border: 1px solid rgb(255 255 255 / 16%);
  font-family: var(--font-data);
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.02em;
  line-height: 1.25;
  white-space: nowrap;
}

.status-chip__spinner {
  width: 0.7rem;
  height: 0.7rem;
  flex-shrink: 0;
  border: 1.5px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  opacity: 0.85;
  animation: status-chip-spin 0.75s linear infinite;
}

@keyframes status-chip-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .status-chip__spinner {
    animation: none;
    border-right-color: currentColor;
    opacity: 0.55;
  }
}

.status-chip[data-tone="success"] {
  color: #bbf7d0;
  background: rgb(34 197 94 / 16%);
  border-color: rgb(34 197 94 / 40%);
}

.status-chip[data-tone="warning"] {
  color: #fde68a;
  background: rgb(245 158 11 / 16%);
  border-color: rgb(245 158 11 / 42%);
}

.status-chip[data-tone="danger"] {
  color: #fecaca;
  background: rgb(239 68 68 / 16%);
  border-color: rgb(239 68 68 / 42%);
}

.status-chip[data-tone="neutral"] {
  color: var(--color-text-muted);
  background: rgb(255 255 255 / 6%);
}
</style>
