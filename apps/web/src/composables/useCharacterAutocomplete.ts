import {
  getCurrentInstance,
  nextTick,
  onBeforeUnmount,
  ref,
  watch,
  type Ref,
} from "vue";
import { api } from "../api/client";
import type { CharacterAutocompleteSuggestion, RealmOption, RegionCode } from "../api/types";
import {
  formatResolveLabel,
  parseCharacterQuery,
  REALM_REQUIRED_HINT,
} from "../lib/parseCharacterQuery";

function suggestionKey(s: Pick<CharacterAutocompleteSuggestion, "name" | "realmSlug" | "region">): string {
  return `${s.region}:${s.realmSlug}:${s.name}`.toLowerCase();
}

/** Prefer a single exact slug/name hit; otherwise require exactly one fuzzy match. */
export function resolveUnambiguousRealm(realms: RealmOption[], realmQuery: string): RealmOption | null {
  const q = realmQuery.trim().toLowerCase().replace(/\s+/g, "-");
  if (!q || realms.length === 0) return null;

  const exact = realms.filter(
    (r) => r.slug.toLowerCase() === q || r.name.toLowerCase() === realmQuery.trim().toLowerCase(),
  );
  if (exact.length === 1) return exact[0]!;
  if (realms.length === 1) return realms[0]!;
  return null;
}

export function buildHybridSuggestions(options: {
  region: RegionCode;
  query: string;
  indexed: CharacterAutocompleteSuggestion[];
  realms: RealmOption[];
}): CharacterAutocompleteSuggestion[] {
  const { region, query, indexed, realms } = options;
  const parsed = parseCharacterQuery(query);
  const results: CharacterAutocompleteSuggestion[] = indexed.map((s) => ({
    ...s,
    kind: s.kind ?? "indexed",
  }));
  const seen = new Set(results.map(suggestionKey));

  if (!parsed.name) return results;

  if (!parsed.realm) {
    if (indexed.length === 0) {
      results.push({
        name: parsed.name,
        realmSlug: "",
        region,
        classSlug: null,
        specSlug: null,
        avatarUrl: null,
        classIconUrl: null,
        kind: "hint",
        source: "hint",
        realmName: null,
        label: REALM_REQUIRED_HINT,
      });
    }
    return results;
  }

  const realm = resolveUnambiguousRealm(realms, parsed.realm);
  if (!realm) return results;

  const resolveSuggestion: CharacterAutocompleteSuggestion = {
    name: parsed.name,
    realmSlug: realm.slug,
    region,
    classSlug: null,
    specSlug: null,
    avatarUrl: null,
    classIconUrl: null,
    kind: "resolve",
    source: "resolve",
    realmName: realm.name,
    label: formatResolveLabel(parsed.name, realm.name),
  };

  if (!seen.has(suggestionKey(resolveSuggestion))) {
    results.push(resolveSuggestion);
  }

  return results;
}

export function useCharacterAutocomplete(region: Ref<string>, query: Ref<string>, debounceMs = 250) {
  const suggestions = ref<CharacterAutocompleteSuggestion[]>([]);
  const loading = ref(false);
  const open = ref(false);
  const activeIndex = ref(-1);

  let timer: ReturnType<typeof setTimeout> | null = null;
  let controller: AbortController | null = null;
  let selecting = false;

  function clearPendingSearch(): void {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    controller?.abort();
    controller = null;
  }

  async function search(q: string): Promise<void> {
    const trimmed = q.trim();
    if (trimmed.length < 3) {
      suggestions.value = [];
      open.value = false;
      activeIndex.value = -1;
      return;
    }

    clearPendingSearch();
    controller = new AbortController();
    const signal = controller.signal;
    loading.value = true;
    const regionCode = region.value.toUpperCase() as RegionCode;
    const parsed = parseCharacterQuery(trimmed);

    try {
      const indexed = await api.searchCharacters(regionCode, trimmed, signal);
      if (signal.aborted) return;

      let realms: RealmOption[] = [];
      if (parsed.realm) {
        realms = await api.searchRealms(regionCode, parsed.realm, signal);
        if (signal.aborted) return;
      }

      const results = buildHybridSuggestions({
        region: regionCode,
        query: trimmed,
        indexed,
        realms,
      });

      suggestions.value = results;
      open.value = results.length > 0;
      activeIndex.value = results.length > 0 ? 0 : -1;
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        suggestions.value = [];
        activeIndex.value = -1;
        open.value = false;
      }
    } finally {
      if (!signal.aborted) {
        loading.value = false;
      }
    }
  }

  function scheduleSearch(value: string): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void search(value);
    }, debounceMs);
  }

  watch(region, () => {
    scheduleSearch(query.value);
  });

  watch(query, (value) => {
    scheduleSearch(value);
  });

  async function select(
    suggestion: CharacterAutocompleteSuggestion,
  ): Promise<CharacterAutocompleteSuggestion | null> {
    if (suggestion.kind === "hint") {
      return null;
    }
    clearPendingSearch();
    selecting = true;
    query.value =
      suggestion.kind === "resolve"
        ? `${suggestion.name}-${suggestion.realmSlug}`
        : `${suggestion.name}-${suggestion.realmSlug}`;
    suggestions.value = [];
    open.value = false;
    activeIndex.value = -1;
    loading.value = false;
    await nextTick();
    window.setTimeout(() => {
      selecting = false;
    }, 200);
    return suggestion;
  }

  function close(): void {
    if (selecting) return;
    open.value = false;
    activeIndex.value = -1;
  }

  function onBlur(): void {
    window.setTimeout(() => {
      close();
    }, 150);
  }

  function moveActive(delta: number): void {
    if (!suggestions.value.length) return;
    if (!open.value) {
      open.value = true;
    }
    const max = suggestions.value.length - 1;
    if (activeIndex.value < 0) {
      activeIndex.value = delta > 0 ? 0 : max;
      return;
    }
    activeIndex.value = Math.max(0, Math.min(max, activeIndex.value + delta));
  }

  function onKeydown(event: KeyboardEvent): void {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (!open.value) {
          void search(query.value);
        } else {
          moveActive(1);
        }
        break;
      case "ArrowUp":
        event.preventDefault();
        if (!open.value) {
          void search(query.value);
        } else {
          moveActive(-1);
        }
        break;
      case "Enter":
        if (open.value && activeIndex.value >= 0 && suggestions.value[activeIndex.value]) {
          const current = suggestions.value[activeIndex.value]!;
          if (current.kind === "hint") {
            event.preventDefault();
            return;
          }
          event.preventDefault();
          void select(current);
        }
        break;
      case "Escape":
        if (open.value) {
          event.preventDefault();
          close();
        }
        break;
      default:
        break;
    }
  }

  function dispose(): void {
    clearPendingSearch();
  }

  if (getCurrentInstance()) {
    onBeforeUnmount(dispose);
  }

  return {
    suggestions,
    loading,
    open,
    activeIndex,
    select,
    close,
    search,
    onBlur,
    onKeydown,
  };
}
