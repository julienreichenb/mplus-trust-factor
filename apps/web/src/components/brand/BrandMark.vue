<script setup lang="ts">
withDefaults(
  defineProps<{
    size?: "sm" | "md" | "lg";
    decorative?: boolean;
  }>(),
  {
    size: "md",
    decorative: false,
  },
);
</script>

<template>
  <span class="brand-mark" :data-size="size" :aria-hidden="decorative ? 'true' : undefined">
    <img
      src="/favicon.svg"
      alt=""
      width="40"
      height="40"
      decoding="async"
      class="brand-mark__img"
    />
  </span>
</template>

<style scoped>
.brand-mark {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
}

.brand-mark__img {
  display: block;
  width: 2rem;
  height: 2rem;
}

.brand-mark[data-size="sm"] .brand-mark__img {
  width: 1.5rem;
  height: 1.5rem;
}

.brand-mark[data-size="lg"] .brand-mark__img {
  width: 2.75rem;
  height: 2.75rem;
}
</style>
