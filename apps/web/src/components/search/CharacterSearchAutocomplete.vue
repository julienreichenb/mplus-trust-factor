<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { useCharacterAutocomplete } from "../../composables/useCharacterAutocomplete";
import { useRecentSearchesStore } from "../../stores/recentSearches";
import { canonicalCharacterPath } from "../../lib/format";
import { parseCharacterQuery } from "../../lib/parseCharacterQuery";
import { classColor, classIconUrl } from "../../lib/wowClass";
import type { CharacterAutocompleteSuggestion } from "../../api/types";

const props = withDefaults(
  defineProps<{
    compact?: boolean;
    showRecent?: boolean;
    inputId?: string;
    placeholder?: string;
    region?: string;
  }>(),
  {
    compact: false,
    showRecent: true,
    inputId: "character-autocomplete",
    placeholder: "Character-Realm (e.g. Aleria-tarren-mill)",
    region: "EU",
  },
);

const router = useRouter();
const recent = useRecentSearchesStore();

const region = ref(props.region);
const query = ref("");
const error = ref<string | null>(null);
const focused = ref(false);

const {
  suggestions,
  loading,
  open,
  activeIndex,
  select,
  search,
  onBlur,
  onKeydown,
} = useCharacterAutocomplete(region, query);

const listboxId = `${props.inputId}-suggestions`;
const activeOptionId = computed(() =>
  open.value && activeIndex.value >= 0 ? `${props.inputId}-option-${activeIndex.value}` : undefined,
);

const recentSuggestions = computed<CharacterAutocompleteSuggestion[]>(() =>
  recent.items
    .filter((item) => item.region.toUpperCase() === region.value.toUpperCase())
    .map((item) => ({
      name: item.name,
      realmSlug: item.realmSlug,
      region: item.region as CharacterAutocompleteSuggestion["region"],
      classSlug: item.classSlug ?? null,
      specSlug: null,
      avatarUrl: null,
      classIconUrl: classIconUrl(item.classSlug),
    })),
);

const displaySuggestions = computed(() => {
  if (query.value.trim().length >= 3) {
    return suggestions.value;
  }
  if (focused.value && recentSuggestions.value.length > 0) {
    return recentSuggestions.value;
  }
  return [];
});

const showList = computed(
  () => focused.value && displaySuggestions.value.length > 0 && (open.value || query.value.trim().length < 3),
);

function navigateTo(suggestion: CharacterAutocompleteSuggestion): void {
  error.value = null;
  const params = canonicalCharacterPath(suggestion.region, suggestion.realmSlug, suggestion.name);
  recent.add({
    region: params.region,
    realmSlug: params.realm,
    name: params.name,
    classSlug: suggestion.classSlug ?? undefined,
  });
  void router.push({ name: "character", params });
}

function submitFromQuery(): void {
  error.value = null;
  const parsed = parseCharacterQuery(query.value);
  if (!parsed.name) {
    error.value = "Enter a character name.";
    return;
  }
  if (!parsed.realm) {
    error.value = "Include the realm after a hyphen (e.g. Aleria-tarren-mill).";
    return;
  }
  navigateTo({
    name: parsed.name,
    realmSlug: parsed.realm.toLowerCase().replace(/\s+/g, "-"),
    region: region.value.toUpperCase() as CharacterAutocompleteSuggestion["region"],
    classSlug: null,
    specSlug: null,
    avatarUrl: null,
    classIconUrl: null,
  });
}

function onSubmit(event: Event): void {
  event.preventDefault();
  if (showList.value && activeIndex.value >= 0 && displaySuggestions.value[activeIndex.value]) {
    navigateTo(displaySuggestions.value[activeIndex.value]!);
    return;
  }
  submitFromQuery();
}

async function onOptionSelect(index: number): Promise<void> {
  const option = displaySuggestions.value[index];
  if (!option) return;
  await select(option);
  navigateTo(option);
}

function onFocus(): void {
  focused.value = true;
  if (query.value.trim().length >= 3) {
    void search(query.value);
  }
}

function handleBlur(): void {
  onBlur();
  window.setTimeout(() => {
    focused.value = false;
  }, 160);
}

function handleKeydown(event: KeyboardEvent): void {
  if (
    event.key === "Enter" &&
    showList.value &&
    activeIndex.value >= 0 &&
    displaySuggestions.value[activeIndex.value]
  ) {
    event.preventDefault();
    const option = displaySuggestions.value[activeIndex.value]!;
    void select(option).then(() => navigateTo(option));
    return;
  }
  onKeydown(event);
}

function iconFor(suggestion: CharacterAutocompleteSuggestion): string | null {
  return suggestion.avatarUrl ?? suggestion.classIconUrl ?? classIconUrl(suggestion.classSlug);
}
</script>

<template>
  <div class="autocomplete" :class="{ 'autocomplete--compact': compact }">
    <form
      :id="compact ? undefined : 'character-search'"
      class="autocomplete__form"
      :aria-label="compact ? 'Quick character search' : 'Character search'"
      :data-testid="compact ? 'navbar-search-form' : 'hero-search-form'"
      @submit="onSubmit"
    >
      <label class="sr-only" :for="inputId">Search character</label>
      <div class="autocomplete__field">
        <input
          :id="inputId"
          v-model="query"
          name="character"
          type="search"
          role="combobox"
          autocomplete="off"
          aria-autocomplete="list"
          :aria-expanded="showList"
          :aria-controls="listboxId"
          :aria-activedescendant="activeOptionId"
          :placeholder="placeholder"
          data-testid="character-autocomplete-input"
          @focus="onFocus"
          @blur="handleBlur"
          @keydown="handleKeydown"
        />
        <span v-if="loading" class="hint" role="status">Searching…</span>
        <ul
          v-if="showList"
          :id="listboxId"
          class="suggestions"
          role="listbox"
          :aria-label="query.trim().length >= 3 ? 'Character suggestions' : 'Recent searches'"
          data-testid="character-suggestions"
        >
          <li
            v-for="(s, index) in displaySuggestions"
            :id="`${inputId}-option-${index}`"
            :key="`${s.region}-${s.realmSlug}-${s.name}`"
            role="option"
            :aria-selected="index === activeIndex"
            :data-testid="`character-option-${s.name}-${s.realmSlug}`"
            :class="{ active: index === activeIndex }"
            @mousedown.prevent="onOptionSelect(index)"
          >
            <img
              v-if="iconFor(s)"
              class="class-icon"
              :src="iconFor(s)!"
              alt=""
              width="24"
              height="24"
            />
            <span v-else class="class-icon class-icon--placeholder" aria-hidden="true" />
            <span class="label">
              <span class="name" :style="{ color: classColor(s.classSlug) }">{{ s.name }}</span
              ><span class="realm">-{{ s.realmSlug }}</span>
            </span>
          </li>
        </ul>
      </div>

      <button
        v-if="!compact"
        type="submit"
        class="btn primary submit"
        data-testid="search-submit"
      >
        Check trust score
      </button>

      <p v-if="error" class="error" role="alert">{{ error }}</p>
    </form>

    <section
      v-if="showRecent && !compact && recent.items.length"
      class="recent"
      aria-labelledby="recent-title"
    >
      <div class="recent-head">
        <h2 id="recent-title">Recent searches</h2>
        <button type="button" class="btn link" @click="recent.clear()">Clear</button>
      </div>
      <ul>
        <li v-for="item in recent.items" :key="`${item.region}-${item.realmSlug}-${item.name}`">
          <button
            type="button"
            class="btn link recent-btn"
            @click="
              navigateTo({
                name: item.name,
                realmSlug: item.realmSlug,
                region: item.region as CharacterAutocompleteSuggestion['region'],
                classSlug: item.classSlug ?? null,
                specSlug: null,
                avatarUrl: null,
                classIconUrl: classIconUrl(item.classSlug),
              })
            "
          >
            <img
              v-if="classIconUrl(item.classSlug)"
              class="class-icon"
              :src="classIconUrl(item.classSlug)!"
              alt=""
              width="20"
              height="20"
            />
            <span :style="{ color: classColor(item.classSlug) }">{{ item.name }}</span>-{{ item.realmSlug }}
            <span class="region-tag">({{ item.region }})</span>
          </button>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.autocomplete {
  display: grid;
  gap: var(--space-6);
}

.autocomplete__form {
  display: grid;
  gap: var(--space-3);
}

.autocomplete--compact .autocomplete__form {
  gap: 0;
}

.autocomplete__field {
  position: relative;
}

input {
  font: inherit;
  min-height: 2.75rem;
  padding: 0.55rem 0.75rem;
  border-radius: var(--radius-control);
  border: 1px solid var(--color-border);
  background: var(--color-obsidian-900);
  color: var(--color-text);
  width: 100%;
}

.autocomplete--compact input {
  min-height: 2.5rem;
  font-size: var(--text-sm);
  min-width: 12rem;
}

input::placeholder {
  color: rgb(200 189 168 / 55%);
}

.suggestions {
  position: absolute;
  z-index: 30;
  left: 0;
  right: 0;
  top: calc(100% + 2px);
  margin: 0;
  padding: var(--space-1) 0;
  list-style: none;
  background: var(--color-surface-hover);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  max-height: 16rem;
  overflow: auto;
}

.suggestions li {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: 0.5rem 0.75rem;
  cursor: pointer;
  font-weight: 400;
}

.suggestions li:hover,
.suggestions li.active {
  background: var(--color-surface);
}

.class-icon {
  width: 1.5rem;
  height: 1.5rem;
  border-radius: var(--radius-pill);
  flex-shrink: 0;
  object-fit: cover;
}

.class-icon--placeholder {
  display: inline-block;
  background: var(--color-iron-700);
}

.label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.name {
  font-weight: 600;
}

.realm {
  color: var(--color-text-muted);
  font-weight: 400;
}

.hint {
  position: absolute;
  right: 0.75rem;
  top: 50%;
  transform: translateY(-50%);
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  pointer-events: none;
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

.recent-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}

.region-tag {
  color: var(--color-text-muted);
  font-size: var(--text-xs);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media (min-width: 768px) {
  .autocomplete:not(.autocomplete--compact) .autocomplete__form {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
  }

  .submit {
    width: auto;
    white-space: nowrap;
  }
}

.autocomplete:not(.autocomplete--compact) .autocomplete__form {
  padding: var(--space-5);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-hero);
  background: rgb(23 23 25 / 88%);
}
</style>
