import { defineStore } from "pinia";
import { ref } from "vue";
import type { CharacterIdentityInput } from "../api/types";
import { identityKey } from "../api/mock/fixtures";

const STORAGE_KEY = "mplus.recentSearches";
const MAX_ITEMS = 8;

function load(): CharacterIdentityInput[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CharacterIdentityInput[];
    return Array.isArray(parsed) ? parsed.slice(0, MAX_ITEMS) : [];
  } catch {
    return [];
  }
}

export const useRecentSearchesStore = defineStore("recentSearches", () => {
  const items = ref<CharacterIdentityInput[]>(typeof localStorage === "undefined" ? [] : load());

  function persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items.value));
    } catch {
      /* ignore quota */
    }
  }

  function add(identity: CharacterIdentityInput): void {
    const next = [
      identity,
      ...items.value.filter((i) => identityKey(i) !== identityKey(identity)),
    ].slice(0, MAX_ITEMS);
    items.value = next;
    persist();
  }

  function clear(): void {
    items.value = [];
    persist();
  }

  return { items, add, clear };
});
