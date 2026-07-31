<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  expanded: boolean;
}>();

const label = computed(() => (props.expanded ? "Collapse" : "Expand"));
</script>

<template>
  <svg
    class="disclosure-chevron"
    :class="{ 'is-expanded': expanded }"
    viewBox="0 0 16 16"
    width="12"
    height="12"
    aria-hidden="true"
    focusable="false"
    data-testid="disclosure-chevron"
  >
    <title>{{ label }}</title>
    <path
      d="M6 3.5 10.5 8 6 12.5"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
</template>

<style scoped>
.disclosure-chevron {
  flex-shrink: 0;
  width: 12px;
  height: 12px;
  color: var(--muted);
  transition: transform 0.15s ease;
  transform: rotate(0deg);
}

.disclosure-chevron.is-expanded {
  transform: rotate(90deg);
}

@media (prefers-reduced-motion: reduce) {
  .disclosure-chevron {
    transition: none;
  }
}
</style>
