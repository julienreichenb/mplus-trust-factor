<script setup lang="ts">
import { onBeforeUnmount, ref, useId } from "vue";

withDefaults(
  defineProps<{
    text: string;
    /** Optional accessible name for the help control. */
    label?: string;
  }>(),
  {
    label: "More information",
  },
);

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
  <span ref="rootEl" class="help-tip" data-testid="help-tooltip">
    <button
      type="button"
      class="help-tip__btn"
      :aria-label="label"
      :aria-describedby="open ? tipId : undefined"
      :aria-expanded="open ? 'true' : 'false'"
      @mouseenter="show"
      @mouseleave="hide"
      @focus="show"
      @blur="hide"
      @click.prevent="toggle"
    >
      ?
    </button>
    <span
      v-show="open"
      :id="tipId"
      class="help-tip__panel"
      role="tooltip"
    >
      {{ text }}
    </span>
  </span>
</template>

<style scoped>
.help-tip {
  position: relative;
  display: inline-flex;
  align-items: center;
  vertical-align: middle;
}

.help-tip__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.25rem;
  height: 1.25rem;
  padding: 0;
  border-radius: 999px;
  border: 1px solid rgb(255 255 255 / 28%);
  background: rgb(255 255 255 / 8%);
  color: var(--color-text);
  font: inherit;
  font-size: 0.7rem;
  font-weight: 700;
  line-height: 1;
  cursor: help;
}

.help-tip__btn:hover,
.help-tip__btn:focus-visible {
  border-color: var(--color-focus);
  outline: none;
  box-shadow: var(--shadow-focus);
}

.help-tip__panel {
  position: absolute;
  z-index: 20;
  left: 50%;
  bottom: calc(100% + 0.4rem);
  transform: translateX(-50%);
  width: max-content;
  max-width: min(20rem, 70vw);
  padding: 0.55rem 0.7rem;
  border-radius: 0.4rem;
  border: 1px solid var(--color-border);
  background: var(--color-bg-elevated);
  color: var(--color-text);
  font-size: var(--text-sm);
  line-height: 1.35;
  box-shadow: 0 8px 24px rgb(0 0 0 / 45%);
  pointer-events: none;
}
</style>
