<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { useRealmAutocomplete } from "../composables/useRealmAutocomplete";
import { useRecentSearchesStore } from "../stores/recentSearches";
import { canonicalCharacterPath } from "../lib/format";

const router = useRouter();
const recent = useRecentSearchesStore();

const region = ref("EU");
const realm = ref("");
const name = ref("");
const error = ref<string | null>(null);

const { suggestions, loading, open, select, close, search } = useRealmAutocomplete(region, realm);

function onRealmBlur(): void {
  window.setTimeout(() => close(), 150);
}

const canSubmit = computed(
  () => region.value.trim() && realm.value.trim() && name.value.trim(),
);

function submit(): void {
  error.value = null;
  if (!region.value.trim()) {
    error.value = "Region is required.";
    return;
  }
  if (!realm.value.trim()) {
    error.value = "Realm is required.";
    return;
  }
  if (!name.value.trim()) {
    error.value = "Character name is required.";
    return;
  }
  const params = canonicalCharacterPath(region.value, realm.value, name.value);
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
</script>

<template>
  <section>
    <h1>Search a character</h1>
    <p>Look up a Retail character by region, realm, and name. EU is the MVP default.</p>

    <form class="search-form" aria-label="Character search" data-testid="search-form" @submit.prevent="submit">
      <label>
        Region
        <select v-model="region" name="region" data-testid="region-select">
          <option value="EU">EU</option>
          <option value="US" disabled>US (soon)</option>
          <option value="KR" disabled>KR (soon)</option>
          <option value="TW" disabled>TW (soon)</option>
        </select>
      </label>

      <label class="realm-field">
        Realm
        <input
          v-model="realm"
          name="realm"
          autocomplete="off"
          aria-autocomplete="list"
          :aria-expanded="open"
          aria-controls="realm-suggestions"
          data-testid="realm-input"
          @focus="void search(realm)"
          @blur="onRealmBlur"
        />
        <ul
          v-if="open && suggestions.length"
          id="realm-suggestions"
          class="suggestions"
          role="listbox"
        >
          <li
            v-for="s in suggestions"
            :key="s.slug"
            role="option"
            @mousedown.prevent="select(s)"
          >
            {{ s.name }} <span class="slug">({{ s.slug }})</span>
          </li>
        </ul>
        <span v-if="loading" class="hint">Searching realms…</span>
      </label>

      <label>
        Character name
        <input v-model="name" name="name" autocomplete="off" data-testid="name-input" />
      </label>

      <p v-if="error" class="error" role="alert">{{ error }}</p>

      <button type="submit" class="btn primary" data-testid="search-submit" :disabled="!canSubmit">
        Search
      </button>
    </form>

    <section v-if="recent.items.length" class="recent" aria-labelledby="recent-title">
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
  </section>
</template>

<style scoped>
.search-form {
  display: grid;
  gap: 0.85rem;
  max-width: 28rem;
}

label {
  display: grid;
  gap: 0.3rem;
  font-weight: 600;
}

input,
select {
  font: inherit;
  padding: 0.55rem 0.7rem;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--fg);
}

.realm-field {
  position: relative;
}

.suggestions {
  position: absolute;
  z-index: 5;
  left: 0;
  right: 0;
  top: calc(100% + 2px);
  margin: 0;
  padding: 0.25rem 0;
  list-style: none;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 6px;
  max-height: 14rem;
  overflow: auto;
}

.suggestions li {
  padding: 0.45rem 0.7rem;
  cursor: pointer;
}

.suggestions li:hover,
.suggestions li:focus {
  background: var(--panel);
}

.slug {
  color: var(--muted);
  font-weight: 400;
}

.hint {
  font-size: 0.8rem;
  color: var(--muted);
  font-weight: 400;
}

.error {
  color: var(--danger);
  margin: 0;
}

.recent {
  margin-top: 2rem;
}

.recent-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.recent ul {
  list-style: none;
  padding: 0;
  margin: 0.5rem 0 0;
  display: grid;
  gap: 0.35rem;
}
</style>
