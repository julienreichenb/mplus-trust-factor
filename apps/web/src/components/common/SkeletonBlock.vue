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
  gap: var(--space-2);
  padding: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  background: var(--color-surface);
}

.skeleton-line {
  height: 0.85rem;
  border-radius: var(--radius-control);
  background: linear-gradient(
    90deg,
    var(--color-iron-850) 0%,
    var(--color-iron-800) 50%,
    var(--color-iron-850) 100%
  );
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

@media (prefers-reduced-motion: reduce) {
  .skeleton-line {
    animation: none;
  }
}
</style>
