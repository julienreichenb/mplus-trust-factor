import {
  getCurrentInstance,
  nextTick,
  onBeforeUnmount,
  ref,
  watch,
  type Ref,
} from "vue";
import { api } from "../api/client";
import type { RealmOption, RegionCode } from "../api/types";

export function useRealmAutocomplete(
  region: Ref<string>,
  query: Ref<string>,
  debounceMs = 250,
) {
  const suggestions = ref<RealmOption[]>([]);
  const loading = ref(false);
  const open = ref(false);
  const activeIndex = ref(-1);
  /** Canonical slug committed by suggestion selection; cleared when the user edits. */
  const selectedSlug = ref<string | null>(null);
  /** Display label paired with selectedSlug; cleared when the user edits. */
  const selectedLabel = ref<string | null>(null);

  let timer: ReturnType<typeof setTimeout> | null = null;
  let controller: AbortController | null = null;
  /** True while applying a suggestion so blur cannot cancel the click. */
  let selecting = false;
  /** Skip the query watcher once after programmatic select. */
  let suppressQueryWatch = false;

  function clearPendingSearch(): void {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    controller?.abort();
    controller = null;
  }

  async function search(q: string): Promise<void> {
    if (selectedSlug.value && query.value === selectedLabel.value) {
      return;
    }

    clearPendingSearch();
    controller = new AbortController();
    const signal = controller.signal;
    loading.value = true;
    try {
      const results = await api.searchRealms(
        region.value.toUpperCase() as RegionCode,
        q,
        signal,
      );
      if (signal.aborted) return;
      if (selectedSlug.value && query.value === selectedLabel.value) {
        return;
      }
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
    selectedSlug.value = null;
    selectedLabel.value = null;
    scheduleSearch(query.value);
  });

  watch(query, (value) => {
    if (suppressQueryWatch) {
      return;
    }
    if (selectedSlug.value !== null && value !== selectedLabel.value) {
      selectedSlug.value = null;
      selectedLabel.value = null;
    }
    scheduleSearch(value);
  });

  async function select(realm: RealmOption): Promise<void> {
    clearPendingSearch();
    selecting = true;
    suppressQueryWatch = true;
    selectedSlug.value = realm.slug;
    selectedLabel.value = realm.name;
    query.value = realm.name;
    suggestions.value = [];
    open.value = false;
    activeIndex.value = -1;
    loading.value = false;
    await nextTick();
    suppressQueryWatch = false;
    window.setTimeout(() => {
      selecting = false;
    }, 200);
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

  /** Prefer an explicit selection; otherwise normalize whatever the user typed. */
  function resolveRealmSlug(): string {
    if (selectedSlug.value) {
      return selectedSlug.value;
    }
    return query.value.trim().toLowerCase().replace(/\s+/g, "-");
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
    selectedSlug,
    selectedLabel,
    select,
    close,
    search,
    onBlur,
    onKeydown,
    resolveRealmSlug,
  };
}
