<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { useRealmAutocomplete } from "../../composables/useRealmAutocomplete";
import { useRecentSearchesStore } from "../../stores/recentSearches";
import { canonicalCharacterPath } from "../../lib/format";

const props = withDefaults(
  defineProps<{
    submitLabel?: string;
    showRecent?: boolean;
    formId?: string;
  }>(),
  {
    submitLabel: "Check trust score",
    showRecent: true,
    formId: "character-search",
  },
);

const router = useRouter();
const recent = useRecentSearchesStore();

const region = ref("EU");
const realm = ref("");
const name = ref("");
const error = ref<string | null>(null);

const {
  suggestions,
  loading,
  open,
  activeIndex,
  select,
  search,
  onBlur,
  onKeydown,
  resolveRealmSlug,
} = useRealmAutocomplete(region, realm);

const listboxId = computed(() => `${props.formId}-realm-suggestions`);
const realmInputId = computed(() => `${props.formId}-realm-input`);
const realmLabelId = computed(() => `${props.formId}-realm-label`);
const activeOptionId = computed(() =>
  open.value && activeIndex.value >= 0 ? `${props.formId}-realm-option-${activeIndex.value}` : undefined,
);

const canSubmit = computed(
  () => region.value.trim() && resolveRealmSlug() && name.value.trim(),
);

function submit(): void {
  error.value = null;
  if (!region.value.trim()) {
    error.value = "Region is required.";
    return;
  }
  const realmSlug = resolveRealmSlug();
  if (!realmSlug) {
    error.value = "Realm is required.";
    return;
  }
  if (!name.value.trim()) {
    error.value = "Character name is required.";
    return;
  }
  const params = canonicalCharacterPath(region.value, realmSlug, name.value);
  recent.add({
    region: params.region,
    realmSlug: params.realm,
    name: params.name,
  });
  void router.push({ name: "character", params });
}

function openRecent(item: { region: string; realmSlug: string; name: string }): void {
  const params = canonicalCharacterPath(item.region, item.realmSlug, item.name);
  void router.push({ name: "character", params });
}

function onOptionMouseDown(index: number): void {
  const option = suggestions.value[index];
  if (option) {
    void select(option);
  }
}
</script>

<template>
  <div class="search-module">
    <form
      :id="props.formId"
      class="search-form"
      aria-label="Character search"
      data-testid="search-form"
      @submit.prevent="submit"
    >
      <label class="field">
        <span class="field__label">Region</span>
        <select v-model="region" name="region" data-testid="region-select">
          <option value="EU">EU</option>
          <option value="US" disabled>US (soon)</option>
          <option value="KR" disabled>KR (soon)</option>
          <option value="TW" disabled>TW (soon)</option>
        </select>
      </label>

      <div class="realm-field field">
        <label :id="realmLabelId" class="field__label" :for="realmInputId">Realm</label>
        <input
          :id="realmInputId"
          v-model="realm"
          name="realm"
          role="combobox"
          autocomplete="off"
          aria-autocomplete="list"
          :aria-expanded="open"
          :aria-controls="listboxId"
          :aria-activedescendant="activeOptionId"
          :aria-labelledby="realmLabelId"
          data-testid="realm-input"
          @focus="void search(realm)"
          @blur="onBlur"
          @keydown="onKeydown"
        />
        <ul
          v-if="open && suggestions.length"
          :id="listboxId"
          class="suggestions"
          role="listbox"
          :aria-labelledby="realmLabelId"
          data-testid="realm-suggestions"
        >
          <li
            v-for="(s, index) in suggestions"
            :id="`${props.formId}-realm-option-${index}`"
            :key="s.slug"
            role="option"
            :aria-selected="index === activeIndex"
            :data-testid="`realm-option-${s.slug}`"
            :class="{ active: index === activeIndex }"
            @mousedown.prevent="onOptionMouseDown(index)"
          >
            {{ s.name }} <span class="slug">({{ s.slug }})</span>
          </li>
        </ul>
        <span v-if="loading" class="hint" role="status">Searching realms…</span>
      </div>

      <label class="field field--name">
        <span class="field__label">Character name</span>
        <input
          v-model="name"
          name="name"
          autocomplete="off"
          data-testid="name-input"
          placeholder="e.g. Aleria"
        />
      </label>

      <p v-if="error" class="error" role="alert">{{ error }}</p>

      <button
        type="submit"
        class="btn primary submit"
        data-testid="search-submit"
        :disabled="!canSubmit"
      >
        {{ props.submitLabel }}
      </button>
    </form>

    <section
      v-if="props.showRecent && recent.items.length"
      class="recent"
      aria-labelledby="recent-title"
    >
      <div class="recent-head">
        <h2 id="recent-title">Recent searches</h2>
        <button type="button" class="btn link" @click="recent.clear()">Clear</button>
      </div>
      <ul>
        <li v-for="item in recent.items" :key="`${item.region}-${item.realmSlug}-${item.name}`">
          <button type="button" class="btn link" @click="openRecent(item)">
            {{ item.name }} — {{ item.realmSlug }} ({{ item.region }})
          </button>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.search-module {
  display: grid;
  gap: var(--space-6);
}

.search-form {
  display: grid;
  gap: var(--space-4);
  padding: var(--space-5);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-hero);
  background: rgb(23 23 25 / 88%);
}

.field,
.realm-field {
  display: grid;
  gap: var(--space-2);
}

.field__label {
  font-weight: 600;
  font-size: var(--text-sm);
  color: var(--color-text);
}

input,
select {
  font: inherit;
  min-height: 2.75rem;
  padding: 0.55rem 0.75rem;
  border-radius: var(--radius-control);
  border: 1px solid var(--color-border);
  background: var(--color-obsidian-900);
  color: var(--color-text);
  width: 100%;
}

input::placeholder {
  color: rgb(200 189 168 / 55%);
}

.realm-field {
  position: relative;
}

.suggestions {
  position: absolute;
  z-index: 20;
  left: 0;
  right: 0;
  top: calc(100% + 2px);
  margin: 0;
  padding: var(--space-1) 0;
  list-style: none;
  background: var(--color-surface-hover);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  max-height: 14rem;
  overflow: auto;
}

.suggestions li {
  padding: 0.55rem 0.75rem;
  cursor: pointer;
  font-weight: 400;
}

.suggestions li:hover,
.suggestions li.active,
.suggestions li:focus {
  background: var(--color-surface);
}

.slug {
  color: var(--color-text-muted);
  font-weight: 400;
}

.hint {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  font-weight: 400;
}

.error {
  color: var(--color-danger-500);
  margin: 0;
  font-size: var(--text-sm);
}

.submit {
  width: 100%;
}

.recent-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-3);
}

.recent h2 {
  margin: 0;
  font-family: var(--font-body);
  font-size: var(--text-base);
  font-weight: 700;
}

.recent ul {
  list-style: none;
  padding: 0;
  margin: var(--space-3) 0 0;
  display: grid;
  gap: var(--space-2);
}

@media (min-width: 768px) {
  .search-form {
    grid-template-columns: 7rem minmax(10rem, 1.2fr) minmax(9rem, 1fr) auto;
    align-items: end;
    gap: var(--space-3);
  }

  .field--name {
    grid-column: auto;
  }

  .error {
    grid-column: 1 / -1;
  }

  .submit {
    width: auto;
    white-space: nowrap;
  }
}

@media (min-width: 1024px) {
  .search-form {
    grid-template-columns: 7.5rem minmax(12rem, 1.3fr) minmax(10rem, 1fr) auto;
  }
}
</style>
