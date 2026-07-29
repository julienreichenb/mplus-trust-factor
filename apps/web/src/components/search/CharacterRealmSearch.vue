<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { api } from "../../api/client";
import type { CharacterAutocompleteSuggestion, RealmOption } from "../../api/types";
import { useCharacterResolve } from "../../composables/useCharacterResolve";
import { useRealmCombobox } from "../../composables/useRealmCombobox";
import { useRecentSearchesStore } from "../../stores/recentSearches";
import { resolveRealmDisplayName } from "../../api/realm-options";
import { classColor, classIconUrl } from "../../lib/wowClass";

const props = withDefaults(
  defineProps<{
    compact?: boolean;
    showRecent?: boolean;
    submitLabel?: string;
    /** When true, emit `resolved` instead of navigating (compare flow). */
    emitOnly?: boolean;
    iconSubmit?: boolean;
  }>(),
  {
    compact: false,
    showRecent: true,
    submitLabel: "Search",
    emitOnly: false,
    iconSubmit: false,
  },
);

const showIconSubmit = computed(() => props.compact || props.iconSubmit);

const emit = defineEmits<{
  resolved: [payload: { name: string; realmSlug: string; region: string }];
}>();

const router = useRouter();
const recent = useRecentSearchesStore();

const characterName = ref("");
const realmQuery = ref("");
const selectedRealm = ref<RealmOption | null>(null);
const touched = ref({ name: false, realm: false, submit: false });
const nameSuggestions = ref<CharacterAutocompleteSuggestion[]>([]);
const nameLoading = ref(false);
const nameOpen = ref(false);
const nameActiveIndex = ref(-1);

const MAX_NAME_SUGGESTIONS = 3;
const NAME_SEARCH_DEBOUNCE_MS = 250;
let nameSearchTimer: ReturnType<typeof setTimeout> | null = null;

const {
  suggestions,
  loading: realmLoading,
  error: realmError,
  open: realmOpen,
  activeIndex,
  scheduleSearch,
  search: searchRealms,
  select: selectRealm,
  onBlur: onRealmBlur,
  onKeydown: onRealmKeydown,
  optionSecondary,
} = useRealmCombobox({
  query: realmQuery,
  selected: selectedRealm,
});

const { uiState, message, profilePath, resolving, resolve, retry } = useCharacterResolve();

const nameId = props.compact ? "navbar-character-name" : "character-name-input";
const realmId = props.compact ? "navbar-realm-input" : "realm-combobox-input";
const nameListboxId = `${nameId}-listbox`;
const listboxId = `${realmId}-listbox`;
const nameActiveOptionId = computed(() =>
  nameOpen.value && nameActiveIndex.value >= 0
    ? `${nameId}-option-${nameActiveIndex.value}`
    : undefined,
);
const activeOptionId = computed(() =>
  realmOpen.value && activeIndex.value >= 0 ? `${realmId}-option-${activeIndex.value}` : undefined,
);

const nameError = computed(() => {
  if (!touched.value.name && !touched.value.submit) return null;
  return characterName.value.trim() ? null : "Enter a character name.";
});

const realmFieldError = computed(() => {
  if (!touched.value.realm && !touched.value.submit) return null;
  return selectedRealm.value ? null : "Select a realm.";
});

const canSubmit = computed(
  () => Boolean(characterName.value.trim() && selectedRealm.value?.slug) && !resolving.value,
);

const statusTone = computed(() => {
  switch (uiState.value) {
    case "NOT_FOUND":
    case "TERMINAL_ERROR":
      return "danger";
    case "RETRYABLE_ERROR":
      return "warn";
    case "QUEUED":
    case "PROCESSING":
    case "RESOLVING":
      return "info";
    default:
      return "muted";
  }
});

watch(realmQuery, (value) => {
  if (selectedRealm.value) {
    const label = selectedRealm.value.displayLabel ?? selectedRealm.value.name;
    if (value !== label) {
      selectedRealm.value = null;
    } else {
      return;
    }
  }
  scheduleSearch(value);
});

watch(characterName, (value) => {
  if (nameSearchTimer) clearTimeout(nameSearchTimer);
  const trimmed = value.trim();
  if (trimmed.length < 3) {
    nameSuggestions.value = [];
    nameOpen.value = false;
    nameActiveIndex.value = -1;
    return;
  }
  nameSearchTimer = setTimeout(() => {
    nameSearchTimer = null;
    void searchCharactersByName(trimmed);
  }, NAME_SEARCH_DEBOUNCE_MS);
});

async function searchCharactersByName(name: string): Promise<void> {
  nameLoading.value = true;
  try {
    const hits = await api.searchCharacters("EU", name);
    nameSuggestions.value = hits.slice(0, MAX_NAME_SUGGESTIONS);
    nameOpen.value = nameSuggestions.value.length > 0;
    nameActiveIndex.value = nameSuggestions.value.length > 0 ? 0 : -1;
  } catch {
    nameSuggestions.value = [];
    nameOpen.value = false;
    nameActiveIndex.value = -1;
  } finally {
    nameLoading.value = false;
  }
}

function recentPortraitUrl(item: {
  classSlug?: string | null;
  avatarUrl?: string | null;
}): string | null {
  return item.avatarUrl ?? classIconUrl(item.classSlug);
}

function matchingNameSuggestion(name: string): CharacterAutocompleteSuggestion | undefined {
  const needle = name.trim().toLowerCase();
  return nameSuggestions.value.find((s) => s.name.toLowerCase() === needle);
}

function formattedRealmName(s: CharacterAutocompleteSuggestion): string {
  return resolveRealmDisplayName(s.realmSlug, s.realmName);
}

function iconFor(suggestion: CharacterAutocompleteSuggestion): string | null {
  return suggestion.avatarUrl ?? suggestion.classIconUrl ?? classIconUrl(suggestion.classSlug);
}

async function onSubmit(event?: Event): Promise<void> {
  event?.preventDefault();
  touched.value = { name: true, realm: true, submit: true };
  if (!canSubmit.value || !selectedRealm.value) return;

  if (props.emitOnly) {
    emit("resolved", {
      name: characterName.value.trim(),
      realmSlug: selectedRealm.value.slug,
      region: selectedRealm.value.region ?? "EU",
    });
    return;
  }

  const result = await resolve({
    name: characterName.value,
    realm: selectedRealm.value,
  });
  if (!result) return;

  if (result.status === "READY" || result.status === "QUEUED" || result.status === "PROCESSING") {
    const path = "profilePath" in result ? result.profilePath : profilePath.value;
    if (!path) return;
    const suggestion = matchingNameSuggestion(characterName.value);
    recent.add({
      region: selectedRealm.value.region ?? "EU",
      realmSlug: selectedRealm.value.slug,
      name: characterName.value.trim(),
      classSlug: suggestion?.classSlug ?? null,
      avatarUrl: suggestion?.avatarUrl ?? null,
    });
    const parts = path.replace(/^\//, "").split("/");
    // /character/:region/:realm/:name
    if (parts[0] === "character" && parts.length >= 4) {
      await router.push({
        name: "character",
        params: {
          region: decodeURIComponent(parts[1]!),
          realm: decodeURIComponent(parts[2]!),
          name: decodeURIComponent(parts.slice(3).join("/")),
        },
      });
    } else {
      await router.push(path);
    }
  }
}

async function onRetry(): Promise<void> {
  const result = await retry();
  if (result && (result.status === "READY" || result.status === "QUEUED" || result.status === "PROCESSING")) {
    const path = "profilePath" in result ? result.profilePath : profilePath.value;
    if (path) await router.push(path);
  }
}

function openRecent(item: { region: string; realmSlug: string; name: string; classSlug?: string | null }): void {
  void router.push({
    name: "character",
    params: {
      region: item.region.toUpperCase(),
      realm: item.realmSlug.toLowerCase(),
      name: item.name,
    },
  });
}

function pickNameSuggestion(suggestion: CharacterAutocompleteSuggestion): void {
  characterName.value = suggestion.name;
  selectedRealm.value = {
    slug: suggestion.realmSlug,
    name: suggestion.realmName ?? suggestion.realmSlug,
    region: suggestion.region,
    displayLabel: `${suggestion.realmName ?? suggestion.realmSlug} — ${suggestion.region}`,
  };
  realmQuery.value = selectedRealm.value.displayLabel!;
  nameSuggestions.value = [];
  nameOpen.value = false;
  nameActiveIndex.value = -1;
  void onSubmit();
}

function onNameFocus(): void {
  const trimmed = characterName.value.trim();
  if (trimmed.length >= 3) {
    void searchCharactersByName(trimmed);
  }
}

function onNameBlur(): void {
  touched.value.name = true;
  window.setTimeout(() => {
    nameOpen.value = false;
    nameActiveIndex.value = -1;
  }, 150);
}

function onNameKeydown(event: KeyboardEvent): void {
  if (!nameOpen.value || !nameSuggestions.value.length) return;
  switch (event.key) {
    case "ArrowDown":
      event.preventDefault();
      nameActiveIndex.value = Math.min(
        nameSuggestions.value.length - 1,
        nameActiveIndex.value < 0 ? 0 : nameActiveIndex.value + 1,
      );
      break;
    case "ArrowUp":
      event.preventDefault();
      nameActiveIndex.value = Math.max(0, nameActiveIndex.value - 1);
      break;
    case "Enter":
      if (nameActiveIndex.value >= 0 && nameSuggestions.value[nameActiveIndex.value]) {
        event.preventDefault();
        pickNameSuggestion(nameSuggestions.value[nameActiveIndex.value]!);
      }
      break;
    case "Escape":
      event.preventDefault();
      nameOpen.value = false;
      nameActiveIndex.value = -1;
      break;
    default:
      break;
  }
}

function onRealmFocus(): void {
  void searchRealms(realmQuery.value);
}

onMounted(() => {
  if (props.compact || !props.showRecent) return;
  void enrichRecentPortraits();
});

async function enrichRecentPortraits(): Promise<void> {
  for (const item of recent.items) {
    if (item.avatarUrl || item.classSlug) continue;
    try {
      const profile = await api.getCharacterProfile({
        region: item.region,
        realmSlug: item.realmSlug,
        name: item.name,
      });
      recent.add({
        region: item.region,
        realmSlug: item.realmSlug,
        name: item.name,
        classSlug: profile.classSlug ?? null,
        avatarUrl: profile.media?.avatarUrl ?? profile.media?.insetUrl ?? null,
      });
    } catch {
      /* keep entry without portrait metadata */
    }
  }
}
</script>

<template>
  <div class="crs" :class="{ 'crs--compact': compact }">
    <form
      class="crs__form"
      :aria-label="compact ? 'Quick character search' : 'Character search'"
      :data-testid="compact ? 'navbar-search-form' : 'hero-search-form'"
      @submit="onSubmit"
    >
      <label class="crs__field crs__field--name" :for="nameId">
        <span class="crs__label">Character</span>
        <input
          :id="nameId"
          v-model="characterName"
          type="text"
          name="character"
          role="combobox"
          autocomplete="off"
          spellcheck="false"
          aria-autocomplete="list"
          :aria-expanded="nameOpen"
          :aria-controls="nameListboxId"
          :aria-activedescendant="nameActiveOptionId"
          placeholder="e.g. Wallidrixe"
          data-testid="character-name-input"
          :aria-invalid="!compact && nameError ? 'true' : undefined"
          @focus="onNameFocus"
          @blur="onNameBlur"
          @keydown="onNameKeydown"
        />
        <span v-if="nameLoading" class="crs__hint crs__hint--name" role="status">Searching…</span>
        <ul
          v-if="nameOpen && nameSuggestions.length"
          :id="nameListboxId"
          class="crs__dropdown crs__dropdown--characters"
          role="listbox"
          aria-label="Character suggestions"
          data-testid="character-name-suggestions"
        >
          <li
            v-for="(s, index) in nameSuggestions"
            :id="`${nameId}-option-${index}`"
            :key="`${s.region}-${s.realmSlug}-${s.name}`"
            role="option"
            :aria-selected="index === nameActiveIndex"
            :data-testid="`character-option-${s.realmSlug}-${s.name}`"
            :class="{ active: index === nameActiveIndex }"
            @mousedown.prevent="pickNameSuggestion(s)"
          >
            <img
              v-if="iconFor(s)"
              class="crs__avatar"
              :src="iconFor(s)!"
              alt=""
              width="24"
              height="24"
            />
            <span v-else class="crs__avatar crs__avatar--neutral crs__avatar--sm" aria-hidden="true" />
            <span class="crs__name-line">
              <span class="crs__name-nickname" :style="{ color: classColor(s.classSlug) }">
                {{ s.name }}
              </span>
              <span class="crs__name-sep"> - </span>
              <span class="crs__name-realm">{{ formattedRealmName(s) }}</span>
            </span>
          </li>
        </ul>
        <span v-if="!compact && nameError" class="crs__field-error" role="alert">{{ nameError }}</span>
      </label>

      <div class="crs__field crs__field--realm">
        <label class="crs__label" :for="realmId">Realm</label>
        <input
          :id="realmId"
          v-model="realmQuery"
          type="text"
          name="realm"
          role="combobox"
          autocomplete="off"
          aria-autocomplete="list"
          :aria-expanded="realmOpen"
          :aria-controls="listboxId"
          :aria-activedescendant="activeOptionId"
          placeholder="Search realm (e.g. Archimonde)"
          data-testid="realm-combobox-input"
          :aria-invalid="!compact && realmFieldError ? 'true' : undefined"
          @focus="onRealmFocus"
          @blur="
            touched.realm = true;
            onRealmBlur();
          "
          @keydown="onRealmKeydown"
        />
        <span v-if="realmLoading" class="crs__hint" role="status">Loading realms…</span>
        <ul
          v-if="realmOpen && (suggestions.length || realmError)"
          :id="listboxId"
          class="crs__dropdown"
          role="listbox"
          aria-label="Realm suggestions"
          data-testid="realm-suggestions"
        >
          <li v-if="realmError" class="crs__dropdown-empty" role="presentation">
            {{ realmError }}
            <button type="button" class="btn link" @mousedown.prevent="searchRealms(realmQuery)">
              Retry
            </button>
          </li>
          <li
            v-else-if="!suggestions.length"
            class="crs__dropdown-empty"
            role="presentation"
          >
            No realms match that search.
          </li>
          <li
            v-for="(s, index) in suggestions"
            :id="`${realmId}-option-${index}`"
            :key="`${s.region}-${s.slug}`"
            role="option"
            :aria-selected="index === activeIndex"
            :data-testid="`realm-option-${s.slug}`"
            :class="{ active: index === activeIndex }"
            @mousedown.prevent="selectRealm(s)"
          >
            <span class="crs__option-name">{{ s.name }}</span>
            <span class="crs__option-meta">{{ optionSecondary(s) }}</span>
          </li>
        </ul>
        <span v-if="!compact && realmFieldError" class="crs__field-error" role="alert">{{ realmFieldError }}</span>
      </div>

      <div class="crs__actions">
        <button
          type="submit"
          class="btn primary crs__submit"
          :class="{ 'crs__submit--icon': showIconSubmit }"
          data-testid="search-submit"
          :disabled="!canSubmit"
          :aria-label="showIconSubmit ? 'Search' : undefined"
        >
          <template v-if="showIconSubmit">
            <span
              v-if="resolving"
              class="crs__submit-spinner"
              role="status"
              aria-label="Searching"
            />
            <svg
              v-else
              class="crs__submit-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-4-4" />
            </svg>
          </template>
          <template v-else>
            <span v-if="resolving" role="status">
              {{ uiState === "PROCESSING" ? "Loading…" : "Searching…" }}
            </span>
            <span v-else>{{ submitLabel }}</span>
          </template>
        </button>
      </div>
    </form>

    <div
      v-if="!compact && (message || uiState === 'QUEUED' || uiState === 'PROCESSING')"
      class="crs__status"
      :data-tone="statusTone"
      role="status"
      data-testid="search-status"
    >
      <p v-if="uiState === 'QUEUED' || uiState === 'PROCESSING'">
        Looking up {{ characterName }} on
        {{ selectedRealm?.displayLabel ?? "selected realm" }}…
      </p>
      <p v-else-if="message">{{ message }}</p>
      <button
        v-if="uiState === 'RETRYABLE_ERROR' || uiState === 'NOT_FOUND'"
        type="button"
        class="btn link"
        data-testid="search-retry"
        @click="onRetry"
      >
        Retry
      </button>
    </div>

    <section
      v-if="showRecent && !compact && recent.items.length"
      class="crs__recent"
      aria-labelledby="recent-title"
    >
      <div class="crs__recent-head">
        <h2 id="recent-title">Recent searches</h2>
        <button type="button" class="btn link" @click="recent.clear()">Clear</button>
      </div>
      <ul>
        <li v-for="item in recent.items" :key="`${item.region}-${item.realmSlug}-${item.name}`">
          <button type="button" class="btn link crs__recent-btn" @click="openRecent(item)">
            <img
              v-if="recentPortraitUrl(item)"
              class="crs__avatar"
              :src="recentPortraitUrl(item)!"
              alt=""
              width="20"
              height="20"
            />
            <span v-else class="crs__avatar crs__avatar--neutral crs__avatar--sm" aria-hidden="true" />
            <span :style="{ color: classColor(item.classSlug) }">{{ item.name }}</span>
            <span class="crs__recent-meta"
              >{{ item.realmSlug }} · {{ item.region }}</span
            >
          </button>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.crs {
  display: grid;
  gap: var(--space-4);
}

.crs__form {
  display: grid;
  gap: var(--space-4);
  padding: var(--space-5);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-hero);
  background: rgb(23 23 25 / 88%);
}

.crs--compact .crs__form {
  padding: 0;
  border: 0;
  background: transparent;
  gap: var(--space-2);
  grid-template-columns: minmax(7rem, 1fr) minmax(8rem, 1.1fr) auto;
  align-items: end;
}

.crs__field {
  display: grid;
  gap: var(--space-2);
  position: relative;
  min-width: 0;
}

.crs__label {
  font-weight: 600;
  font-size: var(--text-sm);
  color: var(--color-text);
}

.crs--compact .crs__label {
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

input {
  font: inherit;
  min-height: 3rem;
  padding: 0.65rem 0.85rem;
  border-radius: var(--radius-control);
  border: 1px solid var(--color-border);
  background: var(--color-obsidian-900);
  color: var(--color-text);
  width: 100%;
}

.crs--compact input {
  min-height: 2.75rem;
  font-size: var(--text-sm);
  padding: 0.5rem 0.7rem;
}

input::placeholder {
  color: rgb(200 189 168 / 55%);
}

input:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus);
  border-color: var(--color-focus);
}

.crs__dropdown {
  position: absolute;
  z-index: 35;
  left: 0;
  right: 0;
  top: calc(100% + 2px);
  margin: 0;
  padding: var(--space-1) 0;
  list-style: none;
  background: var(--color-surface-hover);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  max-height: 12rem;
  overflow: auto;
  width: 100%;
}

.crs__dropdown li {
  display: grid;
  gap: 0.1rem;
  padding: 0.55rem 0.75rem;
  cursor: pointer;
}

.crs__dropdown--characters li {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.crs__name-line {
  display: flex;
  align-items: center;
  min-width: 0;
  font-size: var(--text-sm);
  font-weight: 600;
}

.crs__name-nickname {
  flex-shrink: 0;
}

.crs__name-sep,
.crs__name-realm {
  color: var(--color-text-muted);
  font-weight: 500;
}

.crs__name-realm {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.crs__dropdown li:hover,
.crs__dropdown li.active {
  background: var(--color-surface);
}

.crs__option-name {
  font-weight: 600;
}

.crs__option-meta {
  color: var(--color-text-muted);
  font-size: var(--text-xs);
}

.crs__dropdown-empty {
  color: var(--color-text-muted);
  cursor: default;
}

.crs__hint {
  position: absolute;
  right: 0.75rem;
  top: 2.55rem;
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  pointer-events: none;
}

.crs--compact .crs__hint {
  top: 0.85rem;
}

.crs__hint--name {
  top: 0.85rem;
}

.crs:not(.crs--compact) .crs__hint--name {
  top: 2.55rem;
}

.crs__field-error {
  color: var(--color-danger-500);
  font-size: var(--text-xs);
  margin: 0;
  position: absolute;
  top: calc(100% + 0.2rem);
  left: 0;
}

.crs__actions {
  display: grid;
}

.crs__submit {
  width: 100%;
  min-height: 3rem;
}

.crs__submit:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.crs__submit:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus);
}

.crs--compact .crs__submit {
  min-height: 2.75rem;
  width: auto;
  padding-inline: 0.9rem;
}

.crs__submit--icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.75rem;
  min-width: 2.75rem;
  padding: 0;
}

.crs__submit-icon {
  width: 1.125rem;
  height: 1.125rem;
}

.crs__submit-spinner {
  width: 1rem;
  height: 1rem;
  border: 2px solid rgb(7 7 7 / 25%);
  border-top-color: currentColor;
  border-radius: 50%;
  animation: crs-spin 0.7s linear infinite;
}

@keyframes crs-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .crs__submit-spinner {
    animation: none;
    border-top-color: currentColor;
    opacity: 0.7;
  }
}

.crs__locals {
  display: grid;
  gap: var(--space-2);
}

.crs__group-label {
  margin: 0;
  font-size: var(--text-xs);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.crs__group-label--remote {
  color: var(--color-gold-300);
  text-transform: none;
  letter-spacing: 0;
  font-size: var(--text-sm);
}

.crs__locals ul,
.crs__recent ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-2);
}

.crs__local,
.crs__recent-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  text-align: left;
  background: transparent;
  border: 0;
  color: inherit;
  cursor: pointer;
  padding: 0.35rem 0;
}

.crs__avatar {
  width: 1.75rem;
  height: 1.75rem;
  border-radius: var(--radius-pill);
  object-fit: cover;
  flex-shrink: 0;
}

.crs__avatar--neutral {
  display: inline-block;
  background: linear-gradient(145deg, var(--color-iron-700), var(--color-iron-800));
  border: 1px solid var(--color-border);
}

.crs__avatar--sm {
  width: 1.25rem;
  height: 1.25rem;
}

.crs__local-text {
  display: grid;
  gap: 0.1rem;
  min-width: 0;
}

.crs__local-name {
  font-weight: 600;
}

.crs__local-meta,
.crs__recent-meta {
  color: var(--color-text-muted);
  font-size: var(--text-xs);
}

.crs__status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-control);
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  font-size: var(--text-sm);
}

.crs__status[data-tone="danger"] {
  border-color: rgb(239 68 68 / 45%);
  color: #fecaca;
}

.crs__status[data-tone="warn"] {
  border-color: rgb(245 158 11 / 45%);
  color: var(--color-gold-300);
}

.crs__status[data-tone="info"] {
  border-color: rgb(56 189 248 / 35%);
}

.crs__status p {
  margin: 0;
}

.crs__recent-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-3);
}

.crs__recent h2 {
  margin: 0;
  font-size: var(--text-base);
  font-weight: 700;
}

@media (min-width: 768px) {
  .crs:not(.crs--compact) .crs__form {
    grid-template-columns: minmax(10rem, 1fr) minmax(12rem, 1.2fr) auto;
    gap: var(--space-3);
  }

  .crs:not(.crs--compact) .crs__submit {
    width: auto;
    white-space: nowrap;
    min-width: 7.5rem;
  }

  .crs:not(.crs--compact) .crs__submit.crs__submit--icon {
    width: 2.75rem;
    min-width: 2.75rem;
  }

  .crs:not(.crs--compact) .crs__actions {
    display: flex;
    align-items: flex-end;
  }
}

@media (max-width: 767px) {
  .crs--compact .crs__form {
    grid-template-columns: 1fr;
  }

  .crs--compact .crs__submit {
    width: 100%;
  }

  .crs--compact .crs__submit--icon {
    width: 2.75rem;
    min-width: 2.75rem;
  }
}
</style>
