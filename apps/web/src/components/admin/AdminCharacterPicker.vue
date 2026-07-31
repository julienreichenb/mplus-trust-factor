<script setup lang="ts">
import { computed, ref } from "vue";
import type { AdminCharacterSearchHit } from "@mplus/contracts";
import { ApiClientError } from "../../api/live-client";
import { useSuggestionCombobox } from "../../composables/useSuggestionCombobox";
import { classColor, classIconUrl as classIconFromSlug } from "../../lib/wowClass";

const MAX_SELECTED = 500;

const props = withDefaults(
  defineProps<{
    modelValue: AdminCharacterSearchHit[];
    region?: string;
    disabled?: boolean;
    inputId?: string;
  }>(),
  {
    region: "EU",
    disabled: false,
    inputId: "admin-character-picker",
  },
);

const emit = defineEmits<{
  "update:modelValue": [value: AdminCharacterSearchHit[]];
}>();

const apiBase = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";
const query = ref("");
const region = ref(props.region);
const selectedIds = computed(() => new Set(props.modelValue.map((c) => c.characterId)));

async function fetchSuggestions(q: string, signal: AbortSignal): Promise<AdminCharacterSearchHit[]> {
  const params = new URLSearchParams({
    query: q,
    region: region.value.toUpperCase(),
    limit: "8",
  });
  const response = await fetch(`${apiBase}/api/v1/admin/characters/search?${params}`, {
    credentials: "include",
    headers: { Accept: "application/json" },
    signal,
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const envelope = body as { error?: { message?: string; code?: string } } | null;
    throw new ApiClientError(
      envelope?.error?.message ?? `Search failed (${response.status})`,
      response.status,
      envelope?.error?.code ?? "REQUEST_FAILED",
    );
  }
  return ((body as { suggestions?: AdminCharacterSearchHit[] } | null)?.suggestions ?? []).slice(0, 8);
}

const {
  suggestions,
  loading,
  error: searchError,
  open,
  activeIndex,
  select,
  onBlur,
  onKeydown,
} = useSuggestionCombobox<AdminCharacterSearchHit>({
  query,
  watchSources: [region],
  fetchSuggestions,
  debounceMs: 250,
  minLength: 3,
  canSelect: (item) => !selectedIds.value.has(item.characterId),
});

const listboxId = `${props.inputId}-listbox`;
const activeOptionId = computed(() =>
  open.value && activeIndex.value >= 0 ? `${props.inputId}-option-${activeIndex.value}` : undefined,
);

const atLimit = computed(() => props.modelValue.length >= MAX_SELECTED);

function portraitUrl(hit: AdminCharacterSearchHit): string | null {
  return hit.avatarUrl || hit.classIconUrl || classIconFromSlug(hit.classSlug);
}

function addCharacter(hit: AdminCharacterSearchHit): void {
  if (selectedIds.value.has(hit.characterId) || atLimit.value) return;
  emit("update:modelValue", [...props.modelValue, hit]);
  query.value = "";
}

async function onSelectSuggestion(hit: AdminCharacterSearchHit): Promise<void> {
  const selected = await select(hit);
  if (selected) addCharacter(selected);
}

function removeCharacter(characterId: string): void {
  emit(
    "update:modelValue",
    props.modelValue.filter((c) => c.characterId !== characterId),
  );
}

function clearAll(): void {
  emit("update:modelValue", []);
}

function handleKeydown(event: KeyboardEvent): void {
  onKeydown(event, (item) => {
    addCharacter(item);
  });
}

function isSelected(hit: AdminCharacterSearchHit): boolean {
  return selectedIds.value.has(hit.characterId);
}
</script>

<template>
  <div class="admin-picker" data-testid="admin-character-picker">
    <div class="admin-picker__toolbar">
      <label class="admin-picker__region">
        <span class="admin-picker__label">Region</span>
        <select
          v-model="region"
          class="admin-control"
          :disabled="disabled"
          data-testid="admin-picker-region"
        >
          <option value="EU">EU</option>
          <option value="US">US</option>
          <option value="KR">KR</option>
          <option value="TW">TW</option>
        </select>
      </label>
      <div class="admin-picker__search">
        <label class="admin-picker__label" :for="inputId">Search characters</label>
        <input
          :id="inputId"
          v-model="query"
          class="admin-control"
          type="text"
          role="combobox"
          autocomplete="off"
          :disabled="disabled || atLimit"
          :aria-expanded="open"
          :aria-controls="listboxId"
          :aria-activedescendant="activeOptionId"
          aria-autocomplete="list"
          placeholder="Type at least 3 characters…"
          data-testid="admin-picker-search"
          @keydown="handleKeydown"
          @blur="onBlur"
        />
        <p v-if="loading" class="admin-picker__hint" role="status">Searching…</p>
        <p v-else-if="searchError" class="admin-picker__error" role="alert">{{ searchError }}</p>
        <p
          v-else-if="query.trim().length >= 3 && !loading && suggestions.length === 0 && !open"
          class="admin-picker__hint"
          role="status"
        >
          No persisted characters match.
        </p>
        <ul
          v-if="open && suggestions.length > 0"
          :id="listboxId"
          class="admin-picker__suggestions"
          role="listbox"
          data-testid="admin-picker-suggestions"
        >
          <li
            v-for="(hit, index) in suggestions"
            :id="`${inputId}-option-${index}`"
            :key="hit.characterId"
            role="option"
            :aria-selected="activeIndex === index"
            :class="{
              'is-active': activeIndex === index,
              'is-selected': isSelected(hit),
            }"
            @mousedown.prevent="onSelectSuggestion(hit)"
          >
            <img
              v-if="portraitUrl(hit)"
              class="admin-picker__avatar"
              :src="portraitUrl(hit)!"
              alt=""
              width="28"
              height="28"
            />
            <span v-else class="admin-picker__avatar admin-picker__avatar--fallback" aria-hidden="true" />
            <span class="admin-picker__meta">
              <span class="admin-picker__name" :style="{ color: classColor(hit.classSlug) }">
                {{ hit.name }}-{{ hit.realmName || hit.realmSlug }}
              </span>
              <span class="admin-picker__sub">
                <span class="admin-badge">{{ hit.region }}</span>
                <span v-if="hit.mythicPlusScore != null">{{ hit.mythicPlusScore.toFixed(0) }} M+</span>
                <span v-if="isSelected(hit)">Selected</span>
              </span>
            </span>
          </li>
        </ul>
      </div>
    </div>

    <div class="admin-picker__selected-header">
      <span data-testid="admin-picker-count">{{ modelValue.length }} selected</span>
      <button
        type="button"
        class="btn link"
        :disabled="disabled || modelValue.length === 0"
        data-testid="admin-picker-clear"
        @click="clearAll"
      >
        Clear all
      </button>
    </div>
    <p v-if="atLimit" class="admin-picker__error" role="alert">
      Maximum of {{ MAX_SELECTED }} characters reached.
    </p>
    <ul
      class="admin-picker__selected"
      data-testid="admin-picker-selected"
      :class="{ 'is-scrollable': modelValue.length > 6 }"
    >
      <li v-for="hit in modelValue" :key="hit.characterId" class="admin-picker__row">
        <img
          v-if="portraitUrl(hit)"
          class="admin-picker__avatar"
          :src="portraitUrl(hit)!"
          alt=""
          width="32"
          height="32"
        />
        <span v-else class="admin-picker__avatar admin-picker__avatar--fallback" aria-hidden="true" />
        <span class="admin-picker__meta">
          <span class="admin-badge">{{ hit.region }}</span>
          <span class="admin-picker__name" :style="{ color: classColor(hit.classSlug) }">
            {{ hit.name }}-{{ hit.realmName || hit.realmSlug }}
          </span>
          <span v-if="hit.mythicPlusScore != null" class="admin-picker__score mpts-data">
            {{ hit.mythicPlusScore.toFixed(0) }}
          </span>
        </span>
        <button
          type="button"
          class="btn link"
          :disabled="disabled"
          :aria-label="`Remove ${hit.name}`"
          data-testid="admin-picker-remove"
          @click="removeCharacter(hit.characterId)"
        >
          Remove
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.admin-picker {
  display: grid;
  gap: var(--space-3);
}
.admin-picker__toolbar {
  display: grid;
  gap: var(--space-3);
  grid-template-columns: 7rem minmax(0, 1fr);
}
.admin-picker__label {
  display: block;
  margin-bottom: var(--space-1);
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}
.admin-picker__search {
  position: relative;
}
.admin-picker__hint,
.admin-picker__error {
  margin: var(--space-1) 0 0;
  font-size: var(--text-sm);
}
.admin-picker__error {
  color: var(--color-danger-500);
}
.admin-picker__hint {
  color: var(--color-text-muted);
}
.admin-picker__suggestions {
  position: absolute;
  z-index: 5;
  left: 0;
  right: 0;
  margin: var(--space-1) 0 0;
  padding: var(--space-1);
  list-style: none;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  background: var(--color-surface);
  max-height: 16rem;
  overflow: auto;
}
.admin-picker__suggestions li {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  padding: var(--space-2);
  border-radius: var(--radius-control);
  cursor: pointer;
}
.admin-picker__suggestions li.is-active,
.admin-picker__suggestions li:hover {
  background: var(--color-surface-hover);
}
.admin-picker__suggestions li.is-selected {
  opacity: 0.55;
}
.admin-picker__avatar {
  width: 2rem;
  height: 2rem;
  border-radius: var(--radius-control);
  object-fit: cover;
  flex-shrink: 0;
  background: var(--color-iron-800);
}
.admin-picker__avatar--fallback {
  display: inline-block;
}
.admin-picker__meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
  min-width: 0;
}
.admin-picker__name {
  font-weight: 600;
}
.admin-picker__sub {
  display: flex;
  gap: var(--space-2);
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}
.admin-picker__selected-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}
.admin-picker__selected {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-2);
}
.admin-picker__selected.is-scrollable {
  max-height: calc(6 * 3.25rem);
  overflow-y: auto;
  padding-right: var(--space-1);
}
.admin-picker__row {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  padding: var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  background: var(--color-bg-elevated);
}
.admin-picker__score {
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}
.admin-badge {
  display: inline-flex;
  align-items: center;
  padding: 0.1rem 0.45rem;
  border-radius: var(--radius-control);
  border: 1px solid var(--color-border);
  font-size: var(--text-xs);
  font-family: var(--font-data);
  color: var(--color-text-muted);
}
.admin-control {
  width: 100%;
  min-height: 2.5rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  background: var(--color-bg-elevated);
  color: var(--color-text);
  font: inherit;
}
.admin-control:hover:not(:disabled) {
  border-color: var(--color-iron-700);
  background: var(--color-surface-hover);
}
.admin-control:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus);
}
.admin-control:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
@media (max-width: 640px) {
  .admin-picker__toolbar {
    grid-template-columns: 1fr;
  }
}
</style>
