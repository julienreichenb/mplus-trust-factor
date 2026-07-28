import {
  getCurrentInstance,
  nextTick,
  onBeforeUnmount,
  ref,
  watch,
  type Ref,
} from "vue";
import { api } from "../api/client";
import type { CharacterAutocompleteSuggestion, RegionCode } from "../api/types";

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
    try {
      const results = await api.searchCharacters(
        region.value.toUpperCase() as RegionCode,
        trimmed,
        signal,
      );
      if (signal.aborted) return;
      suggestions.value = results;
      open.value = results.length > 0;
      activeIndex.value = results.length > 0 ? 0 : -1;
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        suggestions.value = [];
        activeIndex.value = -1;
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

  async function select(suggestion: CharacterAutocompleteSuggestion): Promise<CharacterAutocompleteSuggestion> {
    clearPendingSearch();
    selecting = true;
    query.value = `${suggestion.name}-${suggestion.realmSlug}`;
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
          event.preventDefault();
          void select(suggestions.value[activeIndex.value]!);
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
