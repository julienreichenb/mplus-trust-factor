<script setup lang="ts">
defineProps<{
  label?: string;
  lines?: number;
}>();
</script>

<template>
  <div class="skeleton" role="status" aria-live="polite" :aria-label="label ?? 'Loading'">
    <div v-for="n in lines ?? 3" :key="n" class="skeleton-line" />
  </div>
</template>

<style scoped>
.skeleton {
  display: grid;
  gap: 0.5rem;
}

.skeleton-line {
  height: 0.85rem;
  border-radius: 4px;
  background: linear-gradient(90deg, #1e2430 0%, #2a3344 50%, #1e2430 100%);
  background-size: 200% 100%;
  animation: shimmer 1.2s ease-in-out infinite;
}

@keyframes shimmer {
  0% {
    background-position: 100% 0;
  }
  100% {
    background-position: -100% 0;
  }
}
</style>
