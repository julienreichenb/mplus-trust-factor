<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import WowIcon from "./WowIcon.vue";

export interface IconSelectOption {
  value: string;
  label: string;
  /** Safe icon identifier only (not a URL). */
  iconName?: string | null;
}

const props = defineProps<{
  modelValue: string;
  options: IconSelectOption[];
  label: string;
  emptyLabel: string;
  id?: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
  change: [];
}>();

const open = ref(false);
const rootRef = ref<HTMLElement | null>(null);
const triggerRef = ref<HTMLButtonElement | null>(null);
const listRef = ref<HTMLElement | null>(null);
const activeIndex = ref(-1);

const controlId = computed(
  () => props.id ?? `icon-select-${props.label.toLowerCase().replace(/\s+/g, "-")}`,
);
const listboxId = computed(() => `${controlId.value}-listbox`);

const selected = computed(() => props.options.find((o) => o.value === props.modelValue) ?? null);

const displayLabel = computed(() => selected.value?.label ?? props.emptyLabel);
const displayIconName = computed(() => selected.value?.iconName ?? null);

const items = computed(() => [
  { value: "", label: props.emptyLabel, iconName: null as string | null },
  ...props.options,
]);

const activeOptionId = computed(() =>
  open.value && activeIndex.value >= 0 ? `${controlId.value}-option-${activeIndex.value}` : undefined,
);

function selectValue(value: string): void {
  emit("update:modelValue", value);
  emit("change");
  open.value = false;
  void nextTick(() => triggerRef.value?.focus());
}

function closeWithoutChange(): void {
  open.value = false;
  void nextTick(() => triggerRef.value?.focus());
}

function openList(): void {
  if (props.disabled) return;
  open.value = true;
  activeIndex.value = Math.max(
    0,
    items.value.findIndex((i) => i.value === props.modelValue),
  );
  void nextTick(() => {
    listRef.value?.focus();
    scrollActiveIntoView();
  });
}

function toggle(): void {
  if (props.disabled) return;
  if (open.value) closeWithoutChange();
  else openList();
}

function onTriggerKeydown(event: KeyboardEvent): void {
  if (props.disabled) return;
  if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    if (!open.value) openList();
    return;
  }
  if (event.key === "Escape" && open.value) {
    event.preventDefault();
    closeWithoutChange();
  }
}

function onListKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    closeWithoutChange();
    return;
  }
  if (event.key === "Tab") {
    open.value = false;
    return;
  }
  if (event.key === "ArrowDown") {
    event.preventDefault();
    activeIndex.value = Math.min(items.value.length - 1, activeIndex.value + 1);
    scrollActiveIntoView();
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    activeIndex.value = Math.max(0, activeIndex.value - 1);
    scrollActiveIntoView();
    return;
  }
  if (event.key === "Home") {
    event.preventDefault();
    activeIndex.value = 0;
    scrollActiveIntoView();
    return;
  }
  if (event.key === "End") {
    event.preventDefault();
    activeIndex.value = items.value.length - 1;
    scrollActiveIntoView();
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    const item = items.value[activeIndex.value];
    if (item) selectValue(item.value);
    return;
  }
  if (event.key === " ") {
    event.preventDefault();
    const item = items.value[activeIndex.value];
    if (item) selectValue(item.value);
  }
}

function scrollActiveIntoView(): void {
  const el = listRef.value?.querySelector<HTMLElement>(`[data-index="${activeIndex.value}"]`);
  if (el && typeof el.scrollIntoView === "function") {
    el.scrollIntoView({ block: "nearest" });
  }
}

function onDocumentPointer(event: MouseEvent): void {
  if (!open.value || !rootRef.value) return;
  if (!rootRef.value.contains(event.target as Node)) open.value = false;
}

watch(open, (isOpen) => {
  if (isOpen) document.addEventListener("mousedown", onDocumentPointer);
  else document.removeEventListener("mousedown", onDocumentPointer);
});

onBeforeUnmount(() => {
  document.removeEventListener("mousedown", onDocumentPointer);
});
</script>

<template>
  <div ref="rootRef" class="icon-select" data-testid="icon-select">
    <span :id="`${controlId}-label`" class="icon-select__label">{{ label }}</span>
    <button
      :id="controlId"
      ref="triggerRef"
      type="button"
      class="icon-select__trigger"
      role="combobox"
      :aria-expanded="open ? 'true' : 'false'"
      :aria-controls="listboxId"
      :aria-activedescendant="activeOptionId"
      aria-haspopup="listbox"
      :aria-labelledby="`${controlId}-label ${controlId}-value`"
      :disabled="disabled"
      data-testid="icon-select-trigger"
      @click="toggle"
      @keydown="onTriggerKeydown"
    >
      <WowIcon
        v-if="displayIconName"
        :icon-name="displayIconName"
        :alt="''"
        :width="18"
        :height="18"
        class="icon-select__icon"
      />
      <span v-else class="icon-select__icon icon-select__icon--empty" aria-hidden="true" />
      <span :id="`${controlId}-value`" class="icon-select__text">{{ displayLabel }}</span>
      <svg
        class="icon-select__chevron"
        :class="{ 'is-open': open }"
        viewBox="0 0 16 16"
        width="10"
        height="10"
        aria-hidden="true"
        focusable="false"
      >
        <path
          d="M4 6.5 8 10.5 12 6.5"
          fill="none"
          stroke="currentColor"
          stroke-width="1.75"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>

    <ul
      v-show="open"
      :id="listboxId"
      ref="listRef"
      class="icon-select__list"
      role="listbox"
      tabindex="-1"
      :aria-labelledby="`${controlId}-label`"
      data-testid="icon-select-list"
      @keydown="onListKeydown"
    >
      <li
        v-for="(item, index) in items"
        :id="`${controlId}-option-${index}`"
        :key="`${item.value || 'all'}-${index}`"
        role="option"
        class="icon-select__option"
        :class="{ 'is-active': index === activeIndex }"
        :aria-selected="item.value === modelValue ? 'true' : 'false'"
        :data-index="index"
        @mouseenter="activeIndex = index"
        @click="selectValue(item.value)"
      >
        <WowIcon
          v-if="item.iconName"
          :icon-name="item.iconName"
          :alt="''"
          :width="18"
          :height="18"
        />
        <span v-else class="icon-select__icon icon-select__icon--empty" aria-hidden="true" />
        <span>{{ item.label }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.icon-select {
  position: relative;
  display: grid;
  gap: var(--space-1, 0.25rem);
  min-width: 0;
}

.icon-select__label {
  font-weight: 600;
  font-size: 0.85rem;
}

.icon-select__trigger {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  width: 100%;
  min-height: 2.4rem;
  padding: 0.35rem 0.55rem;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--panel-2);
  color: var(--fg);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.icon-select__trigger:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.icon-select__trigger:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.icon-select__text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.icon-select__icon,
.icon-select__icon--empty {
  width: 18px;
  height: 18px;
  border-radius: 3px;
  flex-shrink: 0;
}

.icon-select__icon--empty {
  background: var(--border);
}

.icon-select__chevron {
  flex-shrink: 0;
  color: var(--muted);
  transition: transform 0.15s ease;
}

.icon-select__chevron.is-open {
  transform: rotate(180deg);
}

.icon-select__list {
  position: absolute;
  z-index: 40;
  top: calc(100% + var(--space-1, 0.25rem));
  left: 0;
  right: 0;
  margin: 0;
  padding: var(--space-1, 0.25rem);
  list-style: none;
  max-height: 16rem;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel);
  box-shadow: 0 10px 28px rgb(0 0 0 / 35%);
}

.icon-select__list:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.icon-select__option {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.4rem 0.5rem;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
}

.icon-select__option.is-active,
.icon-select__option[aria-selected="true"] {
  background: color-mix(in srgb, var(--accent) 18%, transparent);
}
</style>
