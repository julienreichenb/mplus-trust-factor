import { computed, onBeforeUnmount, ref, watch, type MaybeRefOrGetter, toValue } from "vue";
import type { CharacterMediaCandidate } from "../lib/characterMediaViewModel";
import { characterMediaCandidatesSignature } from "../lib/characterMediaViewModel";

export interface CharacterMediaLadderOptions {
  /** Max transient retries per candidate URL before advancing. Default 1. */
  maxRetriesPerCandidate?: number;
  /** Delay before retrying the same URL after a transient failure. Default 400ms. */
  retryDelayMs?: number;
  /** Optional identity key (characterId / route key) that forces a full reset when it changes. */
  identityKey?: MaybeRefOrGetter<string | null | undefined>;
}

/**
 * Walks Blizzard media candidates in canonical order on image load failure.
 * Bounded per-URL retry; never loops forever; resets when candidates or identity change.
 */
export function useCharacterMediaLadder(
  candidates: MaybeRefOrGetter<readonly CharacterMediaCandidate[]>,
  options: CharacterMediaLadderOptions = {},
) {
  const maxRetries = options.maxRetriesPerCandidate ?? 1;
  const retryDelayMs = options.retryDelayMs ?? 400;

  const index = ref(0);
  const retriesForCurrent = ref(0);
  /** Bumped to remount <img> on same-URL retry. */
  const loadGeneration = ref(0);
  const exhausted = ref(false);
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  function clearRetryTimer(): void {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  function reset(): void {
    clearRetryTimer();
    index.value = 0;
    retriesForCurrent.value = 0;
    loadGeneration.value = 0;
    exhausted.value = toValue(candidates).length === 0;
  }

  const signature = computed(() =>
    characterMediaCandidatesSignature(
      toValue(candidates),
      toValue(options.identityKey) ?? null,
    ),
  );

  watch(signature, reset, { immediate: true });

  const active = computed(() => {
    const list = toValue(candidates);
    if (exhausted.value || list.length === 0) return null;
    return list[index.value] ?? null;
  });

  const activeUrl = computed(() => active.value?.url ?? null);
  const activeKind = computed(() => active.value?.kind ?? null);
  const activeType = computed(() => active.value?.type ?? null);
  /** Cache-bust same-URL retries so the browser issues a fresh request. */
  const requestUrl = computed(() => {
    const url = activeUrl.value;
    if (!url) return null;
    if (loadGeneration.value <= 0) return url;
    try {
      const parsed = new URL(url, typeof window !== "undefined" ? window.location.origin : "https://local.test");
      parsed.searchParams.set("_mpts_retry", String(loadGeneration.value));
      return parsed.pathname.startsWith("/") && url.startsWith("/")
        ? `${parsed.pathname}${parsed.search}`
        : parsed.toString();
    } catch {
      return url;
    }
  });
  const showRemoteImage = computed(() => Boolean(activeUrl.value) && !exhausted.value);

  function advanceOrExhaust(): void {
    const list = toValue(candidates);
    const next = index.value + 1;
    if (next < list.length) {
      index.value = next;
      retriesForCurrent.value = 0;
      loadGeneration.value += 1;
      return;
    }
    exhausted.value = true;
    clearRetryTimer();
  }

  function onImageError(): void {
    if (exhausted.value) return;
    const list = toValue(candidates);
    if (list.length === 0) {
      exhausted.value = true;
      return;
    }

    if (retriesForCurrent.value < maxRetries) {
      retriesForCurrent.value += 1;
      clearRetryTimer();
      retryTimer = setTimeout(() => {
        retryTimer = null;
        // Remount the same URL once — helps with transient CDN/network blips.
        loadGeneration.value += 1;
      }, retryDelayMs);
      return;
    }

    advanceOrExhaust();
  }

  onBeforeUnmount(clearRetryTimer);

  return {
    active,
    activeUrl,
    requestUrl,
    activeKind,
    activeType,
    showRemoteImage,
    exhausted,
    loadGeneration,
    onImageError,
    reset,
  };
}
