import {
  getCurrentInstance,
  onBeforeUnmount,
  ref,
  watch,
  type Ref,
} from "vue";

export interface UseSuggestionComboboxOptions<T> {
  query: Ref<string>;
  /** Extra reactive deps that should re-trigger search (e.g. region). */
  watchSources?: Array<Ref<unknown>>;
  fetchSuggestions: (query: string, signal: AbortSignal) => Promise<T[]>;
  debounceMs?: number;
  minLength?: number;
  canSelect?: (item: T) => boolean;
}

/**
 * Shared debounced combobox search + keyboard/ARIA state.
 * Used by public character autocomplete and admin character pickers.
 */
export function useSuggestionCombobox<T>(options: UseSuggestionComboboxOptions<T>) {
  const {
    query,
    watchSources = [],
    fetchSuggestions,
    debounceMs = 250,
    minLength = 3,
    canSelect = () => true,
  } = options;

  const suggestions = ref<T[]>([]) as Ref<T[]>;
  const loading = ref(false);
  const error = ref<string | null>(null);
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
    if (trimmed.length < minLength) {
      clearPendingSearch();
      suggestions.value = [];
      open.value = false;
      activeIndex.value = -1;
      error.value = null;
      loading.value = false;
      return;
    }

    clearPendingSearch();
    controller = new AbortController();
    const signal = controller.signal;
    loading.value = true;
    error.value = null;

    try {
      const results = await fetchSuggestions(trimmed, signal);
      if (signal.aborted) return;
      suggestions.value = results;
      open.value = results.length > 0;
      activeIndex.value = results.length > 0 ? 0 : -1;
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        suggestions.value = [];
        activeIndex.value = -1;
        open.value = false;
        error.value = err instanceof Error ? err.message : "Search failed";
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

  for (const source of watchSources) {
    watch(source, () => {
      scheduleSearch(query.value);
    });
  }

  watch(query, (value) => {
    scheduleSearch(value);
  });

  async function select(item: T): Promise<T | null> {
    if (!canSelect(item)) {
      return null;
    }
    clearPendingSearch();
    selecting = true;
    suggestions.value = [];
    open.value = false;
    activeIndex.value = -1;
    loading.value = false;
    window.setTimeout(() => {
      selecting = false;
    }, 200);
    return item;
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

  function onKeydown(event: KeyboardEvent, onEnterSelect?: (item: T) => void): void {
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
          if (!canSelect(current)) {
            event.preventDefault();
            return;
          }
          event.preventDefault();
          void select(current).then((item) => {
            if (item && onEnterSelect) onEnterSelect(item);
          });
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
    error,
    open,
    activeIndex,
    select,
    close,
    search,
    scheduleSearch,
    onBlur,
    onKeydown,
    dispose,
  };
}
