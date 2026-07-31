import { nextTick, type Ref } from "vue";
import { api } from "../api/client";
import { formatRealmSecondaryLabel } from "../api/realm-options";
import type { RealmOption } from "../api/types";
import { useSuggestionCombobox } from "./useSuggestionCombobox";

/**
 * Searchable realm combobox backed by GET /api/v1/realms.
 * Delegates debounce/keyboard/ARIA/abort to useSuggestionCombobox.
 * Region is optional — when omitted, results may span enabled retail regions.
 */
export function useRealmCombobox(options: {
  query: Ref<string>;
  selected: Ref<RealmOption | null>;
  region?: Ref<string | null>;
  debounceMs?: number;
}) {
  const { query, selected, debounceMs = 200 } = options;

  const combobox = useSuggestionCombobox<RealmOption>({
    query,
    watchSources: options.region ? [options.region as Ref<unknown>] : [],
    fetchSuggestions: async (q, signal) => {
      const region = options.region?.value ?? null;
      return api.searchRealms(region as never, q, signal, 40);
    },
    debounceMs,
    minLength: 0,
  });

  async function select(option: RealmOption): Promise<RealmOption> {
    const picked = await combobox.select(option);
    if (!picked) return option;
    selected.value = picked;
    query.value = picked.displayLabel ?? `${picked.name} — ${picked.region ?? "EU"}`;
    await nextTick();
    return picked;
  }

  function clearSelection(): void {
    selected.value = null;
    query.value = "";
  }

  function optionSecondary(option: RealmOption): string {
    return formatRealmSecondaryLabel(option);
  }

  function onKeydown(event: KeyboardEvent): void {
    combobox.onKeydown(event, (item) => {
      void select(item);
    });
  }

  return {
    suggestions: combobox.suggestions,
    loading: combobox.loading,
    error: combobox.error,
    open: combobox.open,
    activeIndex: combobox.activeIndex,
    search: combobox.search,
    scheduleSearch: combobox.scheduleSearch,
    select,
    clearSelection,
    close: combobox.close,
    onBlur: combobox.onBlur,
    onKeydown,
    optionSecondary,
    dispose: combobox.dispose,
  };
}
