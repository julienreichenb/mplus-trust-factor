<script setup lang="ts">
import { onBeforeUnmount, ref, useId } from "vue";

const open = ref(false);
const rootEl = ref<HTMLElement | null>(null);
const tipId = useId();

function show(): void {
  open.value = true;
}

function hide(): void {
  open.value = false;
}

function toggle(): void {
  open.value = !open.value;
}

function onDocPointer(event: PointerEvent): void {
  if (!open.value || !rootEl.value) return;
  if (!rootEl.value.contains(event.target as Node)) hide();
}

if (typeof document !== "undefined") {
  document.addEventListener("pointerdown", onDocPointer);
}

onBeforeUnmount(() => {
  if (typeof document !== "undefined") {
    document.removeEventListener("pointerdown", onDocPointer);
  }
});
</script>

<template>
  <span ref="rootEl" class="score-pop" data-testid="score-context-trigger">
    <span
      class="score-pop__trigger"
      tabindex="0"
      role="button"
      :aria-expanded="open ? 'true' : 'false'"
      :aria-controls="tipId"
      @mouseenter="show"
      @focus="show"
      @click.prevent="toggle"
      @keydown.enter.prevent="toggle"
      @keydown.space.prevent="toggle"
    >
      <slot />
    </span>
    <div
      v-show="open"
      :id="tipId"
      class="score-pop__panel"
      role="tooltip"
      data-testid="score-context-popover"
      @mouseenter="show"
    >
      <slot name="panel" />
    </div>
  </span>
</template>

<style scoped>
.score-pop {
  position: relative;
  display: inline-flex;
  align-items: flex-end;
  justify-self: end;
}

.score-pop__trigger {
  display: grid;
  justify-items: end;
  gap: 0.35rem;
  cursor: help;
}

.score-pop__trigger:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus);
  border-radius: var(--radius-sm);
}

.score-pop__panel {
  position: absolute;
  z-index: 30;
  right: 0;
  top: calc(100% + 0.45rem);
  width: min(22rem, 80vw);
  padding: 0.7rem 0.8rem;
  border-radius: 0.4rem;
  border: 1px solid var(--color-border);
  background: var(--color-bg-elevated);
  color: var(--color-text);
  font-size: var(--text-sm);
  line-height: 1.4;
  box-shadow: 0 8px 24px rgb(0 0 0 / 45%);
}
</style>
