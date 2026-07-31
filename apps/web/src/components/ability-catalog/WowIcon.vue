<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { WOW_ICON_FALLBACK_DATA_URI, wowIconUrl } from "../../lib/wowIcons";

const props = withDefaults(
  defineProps<{
    /** Safe icon identifier (with or without extension). Never an arbitrary URL. */
    iconName?: string | null;
    /** Accessible text; use empty string for decorative icons. */
    alt?: string;
    width?: number;
    height?: number;
    lazy?: boolean;
  }>(),
  {
    iconName: null,
    alt: "",
    width: 40,
    height: 40,
    lazy: true,
  },
);

const failed = ref(false);

const allowlistedSrc = computed(() => wowIconUrl(props.iconName));

const resolvedSrc = computed(() => {
  if (failed.value || !allowlistedSrc.value) return WOW_ICON_FALLBACK_DATA_URI;
  return allowlistedSrc.value;
});

const showingFallback = computed(
  () => failed.value || !allowlistedSrc.value || resolvedSrc.value === WOW_ICON_FALLBACK_DATA_URI,
);

watch(
  () => props.iconName,
  () => {
    failed.value = false;
  },
);

function onError(): void {
  // One-shot fallback — ignore errors while already showing the neutral tile.
  if (failed.value || !allowlistedSrc.value) return;
  failed.value = true;
}
</script>

<template>
  <img
    class="wow-icon"
    :src="resolvedSrc"
    :alt="alt"
    :width="width"
    :height="height"
    :loading="lazy ? 'lazy' : undefined"
    decoding="async"
    data-testid="wow-icon"
    :data-fallback="showingFallback ? 'true' : 'false'"
    :style="{ width: `${width}px`, height: `${height}px` }"
    @error="onError"
  />
</template>

<style scoped>
.wow-icon {
  display: block;
  object-fit: cover;
  border-radius: 4px;
  flex-shrink: 0;
  background: var(--border, #3a3a42);
}
</style>
