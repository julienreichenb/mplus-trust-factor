<script setup lang="ts">
import { onBeforeUnmount, watch } from "vue";

const props = withDefaults(
  defineProps<{
    open: boolean;
    message: string;
    tone?: "info" | "warn" | "error" | "success";
    durationMs?: number;
  }>(),
  {
    tone: "info",
    durationMs: 4500,
  },
);

const emit = defineEmits<{
  close: [];
}>();

let timer: ReturnType<typeof setTimeout> | null = null;

function clearTimer(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

function scheduleClose(): void {
  clearTimer();
  if (!props.open || props.durationMs <= 0) return;
  timer = setTimeout(() => emit("close"), props.durationMs);
}

watch(
  () => [props.open, props.message, props.durationMs] as const,
  () => scheduleClose(),
  { immediate: true },
);

onBeforeUnmount(clearTimer);
</script>

<template>
  <Teleport to="body">
    <Transition name="toast">
      <div
        v-if="open && message"
        class="toast"
        :data-tone="tone"
        role="status"
        aria-live="polite"
        data-testid="app-toast"
      >
        <p class="toast__message">{{ message }}</p>
        <button type="button" class="toast__close" aria-label="Dismiss" @click="emit('close')">
          ×
        </button>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.toast {
  position: fixed;
  right: var(--space-5);
  bottom: var(--space-5);
  z-index: 80;
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  max-width: min(24rem, calc(100vw - 2rem));
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-card);
  border: 1px solid var(--color-border);
  background: rgb(23 23 25 / 94%);
  backdrop-filter: blur(12px);
  box-shadow: 0 12px 32px rgb(0 0 0 / 35%);
}

.toast[data-tone="warn"] {
  border-color: rgb(251 191 36 / 35%);
}

.toast[data-tone="error"] {
  border-color: rgb(239 68 68 / 40%);
}

.toast[data-tone="success"] {
  border-color: rgb(34 197 94 / 35%);
}

.toast[data-tone="info"] {
  border-color: rgb(56 189 248 / 35%);
}

.toast__message {
  margin: 0;
  flex: 1;
  font-size: var(--text-sm);
  line-height: 1.4;
  color: var(--color-text);
}

.toast__close {
  flex-shrink: 0;
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  font-size: 1.25rem;
  line-height: 1;
  cursor: pointer;
  padding: 0;
}

.toast__close:hover,
.toast__close:focus-visible {
  color: var(--color-text);
}

.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 180ms ease,
    transform 180ms ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(0.5rem);
}

@media (prefers-reduced-motion: reduce) {
  .toast-enter-active,
  .toast-leave-active {
    transition: none;
  }
}
</style>
