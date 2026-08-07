<script setup lang="ts">
defineProps<{
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  /** Highlight production ACTIVE model. */
  production?: boolean;
}>();
</script>

<template>
  <span
    class="model-status"
    :class="[`model-status--${status.toLowerCase()}`, { 'model-status--production': production }]"
    data-testid="model-status-badge"
  >
    <span class="model-status__dot" aria-hidden="true" />
    <span class="model-status__label">{{ status }}</span>
    <span v-if="production" class="model-status__prod">Production</span>
  </span>
</template>

<style scoped>
.model-status {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  border: 1px solid var(--color-border);
  background: rgb(255 255 255 / 4%);
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.model-status__dot {
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 999px;
  background: currentColor;
}

.model-status--active {
  color: var(--color-success-500);
  border-color: rgb(34 197 94 / 35%);
  background: rgb(34 197 94 / 10%);
}

.model-status--draft {
  color: var(--color-amber-400);
  border-color: rgb(251 191 36 / 35%);
  background: rgb(251 191 36 / 10%);
}

.model-status--archived {
  color: var(--color-text-muted);
  border-color: var(--color-border);
  background: rgb(255 255 255 / 3%);
}

.model-status__prod {
  margin-left: 0.15rem;
  padding-left: 0.45rem;
  border-left: 1px solid rgb(255 255 255 / 18%);
  color: var(--color-gold-300);
  font-weight: 700;
}
</style>
