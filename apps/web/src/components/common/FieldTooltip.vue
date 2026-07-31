<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useId } from "vue";

withDefaults(
  defineProps<{
    /** Plain-language explanation of what this option or action does. */
    whatItMeans: string;
    /** Optional technical details: formula, exact keys, thresholds, units. */
    technical?: string | null;
    /** Accessible name for the trigger control. */
    label?: string;
  }>(),
  {
    technical: null,
    label: "More information",
  },
);

const open = ref(false);
const rootEl = ref<HTMLElement | null>(null);
const panelEl = ref<HTMLElement | null>(null);
const btnEl = ref<HTMLButtonElement | null>(null);
const tipId = useId();
const placement = ref<"top" | "bottom">("top");
const align = ref<"center" | "left" | "right">("center");

async function updatePlacement(): Promise<void> {
  await nextTick();
  const trigger = btnEl.value;
  const panel = panelEl.value;
  if (!trigger || !panel || typeof window === "undefined") return;
  const triggerRect = trigger.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();

  placement.value = triggerRect.top - panelRect.height < 8 ? "bottom" : "top";

  const halfWidth = panelRect.width / 2;
  if (triggerRect.left + halfWidth > window.innerWidth - 8) {
    align.value = "right";
  } else if (triggerRect.left - halfWidth < 8) {
    align.value = "left";
  } else {
    align.value = "center";
  }
}

function show(): void {
  open.value = true;
  void updatePlacement();
}

function hide(): void {
  open.value = false;
}

function toggle(): void {
  if (open.value) hide();
  else show();
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape" && open.value) {
    event.stopPropagation();
    hide();
    btnEl.value?.focus();
  }
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
  <span ref="rootEl" class="field-tip" data-testid="field-tooltip" @keydown="onKeydown">
    <button
      ref="btnEl"
      type="button"
      class="field-tip__btn"
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
    <div
      v-show="open"
      :id="tipId"
      ref="panelEl"
      class="field-tip__panel"
      :class="[`field-tip__panel--${placement}`, `field-tip__panel--align-${align}`]"
      role="tooltip"
    >
      <p class="field-tip__section">
        <strong>What it means</strong>
        <span>{{ whatItMeans }}</span>
      </p>
      <p v-if="technical" class="field-tip__section field-tip__section--technical" data-testid="field-tooltip-technical">
        <strong>Technical details</strong>
        <span>{{ technical }}</span>
      </p>
    </div>
  </span>
</template>

<style scoped>
.field-tip {
  position: relative;
  display: inline-flex;
  align-items: center;
  vertical-align: middle;
}

.field-tip__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.25rem;
  height: 1.25rem;
  padding: 0;
  border-radius: 999px;
  border: 1px solid rgb(255 255 255 / 28%);
  background: rgb(255 255 255 / 8%);
  color: var(--color-text, var(--fg));
  font: inherit;
  font-size: 0.7rem;
  font-weight: 700;
  line-height: 1;
  cursor: help;
}

.field-tip__btn:hover,
.field-tip__btn:focus-visible {
  border-color: var(--color-focus, var(--accent));
  outline: none;
  box-shadow: var(--shadow-focus, 0 0 0 2px var(--color-focus, var(--accent)));
}

.field-tip__panel {
  position: absolute;
  z-index: 30;
  left: 50%;
  bottom: calc(100% + 0.4rem);
  transform: translateX(-50%);
  width: max-content;
  max-width: min(24rem, 85vw);
  display: grid;
  gap: 0.5rem;
  padding: 0.65rem 0.8rem;
  border-radius: 0.4rem;
  border: 1px solid var(--color-border, var(--border));
  background: var(--color-bg-elevated, var(--panel));
  color: var(--color-text, var(--fg));
  font-size: var(--text-sm, 0.85rem);
  line-height: 1.4;
  box-shadow: 0 8px 24px rgb(0 0 0 / 45%);
  pointer-events: none;
}

.field-tip__panel--bottom {
  bottom: auto;
  top: calc(100% + 0.4rem);
}

.field-tip__panel--align-left {
  left: 0;
  transform: none;
}

.field-tip__panel--align-right {
  left: auto;
  right: 0;
  transform: none;
}

.field-tip__section {
  margin: 0;
  display: grid;
  gap: 0.15rem;
}

.field-tip__section strong {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-muted, var(--muted));
}

.field-tip__section--technical span {
  font-family: var(--font-data, monospace);
  font-size: 0.8em;
  word-break: break-word;
}
</style>
