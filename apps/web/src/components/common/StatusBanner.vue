<script setup lang="ts">
import type { PropType } from "vue";

defineProps({
  tone: {
    type: String as PropType<"info" | "warn" | "error" | "success">,
    default: "info",
  },
  title: { type: String, default: "" },
});
</script>

<template>
  <div class="banner" :data-tone="tone" role="status" aria-live="polite">
    <strong v-if="title">{{ title }}</strong>
    <div class="banner-body">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.banner {
  border: 1px solid var(--border);
  border-left-width: 4px;
  padding: 0.75rem 1rem;
  border-radius: 6px;
  background: var(--panel);
  margin: 0.75rem 0;
}

.banner[data-tone="info"] {
  border-left-color: var(--accent);
}

.banner[data-tone="warn"] {
  border-left-color: var(--warn);
}

.banner[data-tone="error"] {
  border-left-color: var(--danger);
}

.banner[data-tone="success"] {
  border-left-color: var(--ok);
}

.banner-body {
  margin-top: 0.25rem;
}
</style>
