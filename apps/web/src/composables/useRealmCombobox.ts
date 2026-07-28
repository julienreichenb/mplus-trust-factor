import {
  getCurrentInstance,
  nextTick,
  onBeforeUnmount,
  ref,
  type Ref,
} from "vue";
import { api } from "../api/client";
import { formatRealmSecondaryLabel } from "../api/realm-options";
import type { RealmOption } from "../api/types";

/**
 * Searchable realm combobox backed by GET /api/v1/realms.
 * Region is optional — when omitted, results may span enabled retail regions.
 */
export function useRealmCombobox(options: {
  query: Ref<string>;
  selected: Ref<RealmOption | null>;
  region?: Ref<string | null>;
  debounceMs?: number;
}) {
  const { query, selected, debounceMs = 200 } = options;
  const suggestions = ref<RealmOption[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const open = ref(false);
  const activeIndex = ref(-1);

  let timer: ReturnType<typeof setTimeout> | null = null;
  let controller: AbortController | null = null;
  let selecting = false;

  function clearPending(): void {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    controller?.abort();
    controller = null;
  }

  async function search(q: string): Promise<void> {
    clearPending();
    controller = new AbortController();
    const signal = controller.signal;
    loading.value = true;
    error.value = null;
    try {
      const region = options.region?.value ?? null;
      const results = await api.searchRealms(
        region as never,
        q,
        signal,
        40,
      );
      if (signal.aborted) return;
      suggestions.value = results;
      open.value = true;
      activeIndex.value = results.length > 0 ? 0 : -1;
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        suggestions.value = [];
        error.value = "Unable to load realms. Retry.";
        open.value = true;
        activeIndex.value = -1;
      }
    } finally {
      if (!signal.aborted) loading.value = false;
    }
  }

  function scheduleSearch(value: string): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void search(value);
    }, debounceMs);
  }

  async function select(option: RealmOption): Promise<RealmOption> {
    clearPending();
    selecting = true;
    selected.value = option;
    query.value = option.displayLabel ?? `${option.name} — ${option.region ?? "EU"}`;
    suggestions.value = [];
    open.value = false;
    activeIndex.value = -1;
    loading.value = false;
    await nextTick();
    window.setTimeout(() => {
      selecting = false;
    }, 180);
    return option;
  }

  function clearSelection(): void {
    selected.value = null;
    query.value = "";
  }

  function close(): void {
    if (selecting) return;
    open.value = false;
    activeIndex.value = -1;
  }

  function onBlur(): void {
    window.setTimeout(() => close(), 150);
  }

  function moveActive(delta: number): void {
    if (!suggestions.value.length) return;
    if (!open.value) open.value = true;
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
        if (!open.value) void search(query.value);
        else moveActive(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        if (!open.value) void search(query.value);
        else moveActive(-1);
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

  function optionSecondary(option: RealmOption): string {
    return formatRealmSecondaryLabel(option);
  }

  function dispose(): void {
    clearPending();
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
    search,
    scheduleSearch,
    select,
    clearSelection,
    close,
    onBlur,
    onKeydown,
    optionSecondary,
  };
}
