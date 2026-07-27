import { onBeforeUnmount, ref, watch, type Ref } from "vue";
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
  let timer: ReturnType<typeof setTimeout> | null = null;
  let controller: AbortController | null = null;

  async function search(q: string): Promise<void> {
    controller?.abort();
    controller = new AbortController();
    loading.value = true;
    try {
      suggestions.value = await api.searchRealms(
        region.value.toUpperCase() as RegionCode,
        q,
        controller.signal,
      );
      open.value = true;
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        suggestions.value = [];
      }
    } finally {
      loading.value = false;
    }
  }

  watch([region, query], () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void search(query.value);
    }, debounceMs);
  });

  function select(realm: RealmOption): void {
    query.value = realm.slug;
    open.value = false;
  }

  function close(): void {
    open.value = false;
  }

  onBeforeUnmount(() => {
    if (timer) clearTimeout(timer);
    controller?.abort();
  });

  return { suggestions, loading, open, select, close, search };
}
