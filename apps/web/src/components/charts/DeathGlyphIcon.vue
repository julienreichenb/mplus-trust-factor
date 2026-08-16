<script setup lang="ts">
withDefaults(
  defineProps<{
    layout?: "chart" | "fill";
  }>(),
  { layout: "fill" },
);
</script>

<template>
  <svg
    class="death-icon"
    viewBox="0 0 16 16"
    width="16"
    height="16"
    aria-hidden="true"
    focusable="false"
    data-testid="death-glyph-icon"
  >
    <path
      d="M8 2.2c-2.6 0-4.6 1.9-4.6 4.2 0 1.5.7 2.7 1.8 3.5v1.4c0 .4.3.7.7.7h4.2c.4 0 .7-.3.7-.7V9.9c1.1-.8 1.8-2 1.8-3.5C12.6 4.1 10.6 2.2 8 2.2z"
      fill="none"
      stroke="currentColor"
      stroke-width="1.35"
      stroke-linejoin="round"
    />
    <circle cx="6.15" cy="6.35" r="0.95" fill="currentColor" />
    <circle cx="9.85" cy="6.35" r="0.95" fill="currentColor" />
    <path
      d="M6.6 9.15h2.8M7.1 12.6h1.8M6.2 13.6h3.6"
      fill="none"
      stroke="currentColor"
      stroke-width="1.2"
      stroke-linecap="round"
    />
  </svg>
</template>

<style scoped>
.death-icon {
  display: block;
  width: 14px;
  height: 14px;
}
</style>
