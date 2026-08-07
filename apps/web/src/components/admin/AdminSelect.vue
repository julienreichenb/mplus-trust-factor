<script setup lang="ts">
import { computed, useId } from "vue";

const props = withDefaults(
  defineProps<{
    modelValue: string;
    label: string;
    options: Array<{ value: string; label: string; disabled?: boolean }>;
    disabled?: boolean;
    hint?: string | null;
    error?: string | null;
  }>(),
  {
    disabled: false,
    hint: null,
    error: null,
  },
);

const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const selectId = useId();
const hintId = useId();
const errorId = useId();

const describedBy = computed(() => {
  const ids: string[] = [];
  if (props.error) ids.push(errorId);
  else if (props.hint) ids.push(hintId);
  return ids.length ? ids.join(" ") : undefined;
});
</script>

<template>
  <label class="admin-select" :for="selectId">
    <span class="admin-select__label">{{ label }}</span>
    <span class="admin-select__control-wrap">
      <select
        :id="selectId"
        class="admin-select__control"
        :value="modelValue"
        :disabled="disabled"
        :aria-invalid="error ? 'true' : undefined"
        :aria-describedby="describedBy"
        data-testid="admin-select"
        @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
      >
        <option
          v-for="opt in options"
          :key="opt.value"
          :value="opt.value"
          :disabled="opt.disabled"
        >
          {{ opt.label }}
        </option>
      </select>
      <span class="admin-select__chevron" aria-hidden="true">▾</span>
    </span>
    <span v-if="error" :id="errorId" class="admin-select__error" role="alert">{{ error }}</span>
    <span v-else-if="hint" :id="hintId" class="admin-select__hint">{{ hint }}</span>
  </label>
</template>

<style scoped>
.admin-select {
  display: grid;
  gap: var(--space-2);
  min-width: min(100%, 18rem);
}

.admin-select__label {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-text);
}

.admin-select__control-wrap {
  position: relative;
  display: block;
}

.admin-select__control {
  appearance: none;
  width: 100%;
  padding: 0.65rem 2.25rem 0.65rem 0.85rem;
  border-radius: var(--radius-control);
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
  font-size: var(--text-sm);
  line-height: 1.3;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease,
    background 0.15s ease;
}

.admin-select__control:hover:not(:disabled) {
  border-color: rgb(245 158 11 / 45%);
  background: var(--color-surface-hover);
}

.admin-select__control:focus-visible {
  outline: none;
  border-color: var(--color-focus);
  box-shadow: 0 0 0 2px rgb(251 191 36 / 35%);
}

.admin-select__control:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.admin-select__control[aria-invalid="true"] {
  border-color: var(--color-danger-500);
}

.admin-select__chevron {
  position: absolute;
  right: 0.75rem;
  top: 50%;
  transform: translateY(-50%);
  pointer-events: none;
  color: var(--color-text-muted);
  font-size: 0.75rem;
}

.admin-select__hint,
.admin-select__error {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}

.admin-select__error {
  color: var(--color-danger-500);
}
</style>
