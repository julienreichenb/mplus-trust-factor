<script setup lang="ts">
defineProps<{
  kind: "play" | "stop";
}>();
</script>

<template>
  <svg
    class="media-icon"
    viewBox="0 0 16 16"
    width="14"
    height="14"
    aria-hidden="true"
    focusable="false"
  >
    <path
      v-if="kind === 'play'"
      fill="currentColor"
      d="M4.2 2.1v11.8L14 8 4.2 2.1z"
    />
    <rect v-else x="3.5" y="3.5" width="9" height="9" rx="1" fill="currentColor" />
  </svg>
</template>
