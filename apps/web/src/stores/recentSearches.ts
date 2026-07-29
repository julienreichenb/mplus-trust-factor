import { defineStore } from "pinia";
import { ref } from "vue";
import type { CharacterIdentityInput } from "../api/types";
import { identityKey } from "../api/mock/fixtures";

const STORAGE_KEY = "mplus.recentSearches";
const MAX_ITEMS = 5;

export interface RecentSearchEntry extends CharacterIdentityInput {
  classSlug?: string | null;
  avatarUrl?: string | null;
}

function normalize(items: RecentSearchEntry[]): RecentSearchEntry[] {
  return items.slice(0, MAX_ITEMS);
}

function load(): RecentSearchEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentSearchEntry[];
    if (!Array.isArray(parsed)) return [];
    const trimmed = normalize(parsed);
    if (trimmed.length !== parsed.length) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    }
    return trimmed;
  } catch {
    return [];
  }
}

export const useRecentSearchesStore = defineStore("recentSearches", () => {
  const items = ref<RecentSearchEntry[]>(
    typeof localStorage === "undefined" ? [] : load(),
  );

  function persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items.value));
    } catch {
      /* ignore quota */
    }
  }

  function add(identity: RecentSearchEntry): void {
    const key = identityKey(identity);
    const existing = items.value.find((i) => identityKey(i) === key);
    const merged: RecentSearchEntry = {
      region: identity.region,
      realmSlug: identity.realmSlug,
      name: identity.name,
      classSlug: identity.classSlug ?? existing?.classSlug ?? null,
      avatarUrl: identity.avatarUrl ?? existing?.avatarUrl ?? null,
    };
    const next = [merged, ...items.value.filter((i) => identityKey(i) !== key)];
    items.value = normalize(next);
    persist();
  }

  function clear(): void {
    items.value = [];
    persist();
  }

  return { items, add, clear };
});
