<script setup lang="ts">
defineProps<{
  href: string;
  label: string;
  itemId?: number | null;
}>();
</script>

<template>
  <a
    class="wowhead-link"
    :href="href"
    target="_blank"
    rel="noopener noreferrer"
    :data-wowhead="itemId != null ? `item=${itemId}` : undefined"
  >
    {{ label }}
  </a>
</template>

<style scoped>
.wowhead-link {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-gold-300);
  text-decoration: none;
}

.wowhead-link:hover,
.wowhead-link:focus-visible {
  color: var(--color-brand-hover);
  text-decoration: underline;
  text-underline-offset: 0.2em;
}
</style>
