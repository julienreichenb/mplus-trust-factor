<script lang="ts">
/** Ensures only one nav disclosure stays open app-wide. */
let closeOpenDisclosure: (() => void) | null = null;
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { RouterLink, useRoute } from "vue-router";

export interface NavDropdownItem {
  to: string;
  label: string;
}

const props = withDefaults(
  defineProps<{
    label: string;
    items: NavDropdownItem[];
    /** When true, the trigger matches the active-nav visual treatment. */
    active?: boolean;
    panelId?: string;
  }>(),
  {
    active: false,
    panelId: undefined,
  },
);

const open = ref(false);
const rootEl = ref<HTMLElement | null>(null);
const triggerEl = ref<HTMLButtonElement | null>(null);
const panelEl = ref<HTMLElement | null>(null);
const route = useRoute();

const resolvedPanelId = computed(
  () => props.panelId ?? `nav-disclosure-${props.label.toLowerCase().replace(/\s+/g, "-")}`,
);

function close(): void {
  if (!open.value) return;
  open.value = false;
  if (closeOpenDisclosure === close) closeOpenDisclosure = null;
  removeDocumentListeners();
}

function openPanel(focus: "first" | "last" | "none" = "none"): void {
  if (closeOpenDisclosure && closeOpenDisclosure !== close) {
    closeOpenDisclosure();
  }
  closeOpenDisclosure = close;
  open.value = true;
  addDocumentListeners();
  if (focus === "none") return;
  void nextTick(() => {
    const links = linkEls();
    const target = focus === "last" ? links[links.length - 1] : links[0];
    target?.focus();
  });
}

function toggle(): void {
  if (open.value) close();
  else openPanel();
}

function linkEls(): HTMLAnchorElement[] {
  if (!panelEl.value) return [];
  return Array.from(panelEl.value.querySelectorAll<HTMLAnchorElement>("a"));
}

function addDocumentListeners(): void {
  document.addEventListener("pointerdown", onDocumentPointerDown);
  document.addEventListener("keydown", onDocumentKeydown);
}

function removeDocumentListeners(): void {
  document.removeEventListener("pointerdown", onDocumentPointerDown);
  document.removeEventListener("keydown", onDocumentKeydown);
}

function onDocumentPointerDown(event: PointerEvent): void {
  if (!open.value || !rootEl.value) return;
  if (!rootEl.value.contains(event.target as Node)) close();
}

function onDocumentKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape" && open.value) {
    event.preventDefault();
    close();
    triggerEl.value?.focus();
  }
}

function onTriggerKeydown(event: KeyboardEvent): void {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    if (!open.value) openPanel("first");
    else linkEls()[0]?.focus();
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    if (!open.value) openPanel("last");
    else {
      const links = linkEls();
      links[links.length - 1]?.focus();
    }
  }
}

function onRootFocusOut(event: FocusEvent): void {
  if (!open.value || !rootEl.value) return;
  const next = event.relatedTarget as Node | null;
  if (next && rootEl.value.contains(next)) return;
  // Defer so click-activated navigation inside the panel can run first.
  void nextTick(() => {
    if (!open.value || !rootEl.value) return;
    const active = document.activeElement;
    if (active && rootEl.value.contains(active)) return;
    close();
  });
}

function onItemSelect(): void {
  close();
}

watch(
  () => route.fullPath,
  () => {
    close();
  },
);

watch(
  () => props.items,
  (items) => {
    if (items.length === 0) close();
  },
);

onBeforeUnmount(() => {
  if (closeOpenDisclosure === close) closeOpenDisclosure = null;
  removeDocumentListeners();
});

defineExpose({ close, open: openPanel, isOpen: open });
</script>

<template>
  <div
    ref="rootEl"
    class="nav-dropdown"
    @focusout="onRootFocusOut"
  >
    <button
      ref="triggerEl"
      type="button"
      class="nav-dropdown__trigger"
      :class="{ 'is-active': active, 'is-open': open }"
      :aria-expanded="open ? 'true' : 'false'"
      :aria-controls="resolvedPanelId"
      data-testid="nav-dropdown-trigger"
      @click="toggle"
      @keydown="onTriggerKeydown"
    >
      {{ label }}
      <span class="nav-dropdown__chevron" aria-hidden="true" />
    </button>

    <div
      v-show="open"
      :id="resolvedPanelId"
      ref="panelEl"
      class="nav-dropdown__panel"
      data-testid="nav-dropdown-menu"
    >
      <ul class="nav-dropdown__list">
        <li v-for="item in items" :key="item.to">
          <RouterLink
            class="nav-dropdown__item"
            :to="item.to"
            @click="onItemSelect"
          >
            {{ item.label }}
          </RouterLink>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.nav-dropdown {
  position: relative;
  display: inline-flex;
  align-items: center;
  max-width: 100%;
}

.nav-dropdown__trigger {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--color-text);
  font: inherit;
  font-weight: 600;
  font-size: var(--text-sm);
  cursor: pointer;
  text-decoration: none;
}

.nav-dropdown__trigger:hover,
.nav-dropdown__trigger:focus-visible {
  color: var(--color-brand-hover);
  text-decoration: underline;
  text-underline-offset: 0.3em;
}

.nav-dropdown__trigger.is-active,
.nav-dropdown__trigger.is-open {
  color: var(--color-brand);
  text-decoration: underline;
  text-underline-offset: 0.3em;
}

.nav-dropdown__trigger:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
  border-radius: 2px;
}

.nav-dropdown__chevron {
  width: 0.35rem;
  height: 0.35rem;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  transform: rotate(45deg);
  transition: transform var(--duration-fast);
  flex-shrink: 0;
  margin-bottom: 0.15rem;
}

.nav-dropdown__trigger.is-open .nav-dropdown__chevron {
  transform: rotate(-135deg);
  margin-bottom: 0;
}

.nav-dropdown__panel {
  position: absolute;
  z-index: 60;
  top: calc(100% + 0.45rem);
  left: 0;
  min-width: 12.5rem;
  max-width: min(18rem, calc(100vw - 2 * var(--gutter-mobile)));
  margin: 0;
  padding: var(--space-1);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  background: var(--color-surface-hover);
  box-shadow: 0 12px 32px rgb(0 0 0 / 45%);
}

.nav-dropdown__list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.nav-dropdown__item {
  display: block;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-control);
  color: var(--color-text);
  font-weight: 600;
  font-size: var(--text-sm);
  text-decoration: none;
  overflow-wrap: anywhere;
}

.nav-dropdown__item:hover,
.nav-dropdown__item:focus-visible,
.nav-dropdown__item.router-link-active {
  background: color-mix(in srgb, var(--color-gold-300) 12%, transparent);
  color: var(--color-brand);
  text-decoration: underline;
  text-underline-offset: 0.2em;
}

.nav-dropdown__item:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 1px;
}

@media (max-width: 767px) {
  .nav-dropdown__panel {
    left: 0;
    right: auto;
  }
}
</style>
