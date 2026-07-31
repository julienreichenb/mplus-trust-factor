<script setup lang="ts">
import { computed, useSlots, type PropType } from "vue";

const props = defineProps({
  tone: {
    type: String as PropType<"info" | "warn" | "error" | "success">,
    default: "info",
  },
  title: { type: String, default: "" },
  /** Convenience body text when no default slot is provided. */
  message: { type: String, default: "" },
});

const slots = useSlots();
const hasBody = computed(() => {
  if (props.message.trim()) return true;
  const nodes = slots.default?.() ?? [];
  return nodes.some((node) => {
    if (typeof node.children === "string") return node.children.trim().length > 0;
    return node.children != null;
  });
});
const visible = computed(() => Boolean(props.title.trim()) || hasBody.value);
</script>

<template>
  <div
    v-if="visible"
    class="banner"
    :data-tone="tone"
    role="status"
    aria-live="polite"
    data-testid="status-banner"
  >
    <strong v-if="title">{{ title }}</strong>
    <div v-if="hasBody" class="banner-body" :class="{ 'banner-body--flush': !title }">
      <slot>{{ message }}</slot>
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
  margin: 0;
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

.banner-body--flush {
  margin-top: 0;
}
</style>
