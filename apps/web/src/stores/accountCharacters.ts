import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type { AccountCharactersResponse, AccountOwnedCharacterDTO } from "@mplus/contracts";

const apiBase = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

export type AccountAuthMe = {
  authenticated: boolean;
  user?: { id: string; displayName: string | null; roles: string[]; permissions: string[] };
};

export type BattlenetLinkStatus = {
  linked: boolean;
  account?: {
    providerAccountId: string;
    battletag: string | null;
    linkedAt: string;
    lastOwnershipSyncAt: string | null;
    lastOwnershipSyncError: string | null;
  };
};

/**
 * Shared Battle.net account-character roster for Account and Character pages.
 * Loads once per session unless `force` is passed to `ensureLoaded`.
 */
export const useAccountCharactersStore = defineStore("accountCharacters", () => {
  const me = ref<AccountAuthMe | null>(null);
  const battlenet = ref<BattlenetLinkStatus | null>(null);
  const accountChars = ref<AccountCharactersResponse | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const loaded = ref(false);

  const authenticated = computed(() => Boolean(me.value?.authenticated));
  const linked = computed(() => Boolean(battlenet.value?.linked));
  const characters = computed<AccountOwnedCharacterDTO[]>(
    () => accountChars.value?.characters ?? [],
  );
  const hasCharacters = computed(() => characters.value.length > 0);
  const showSwitcher = computed(
    () => authenticated.value && linked.value && hasCharacters.value,
  );

  async function fetchJson<T>(path: string): Promise<T> {
    const res = await fetch(`${apiBase}${path}`, { credentials: "include" });
    if (!res.ok) {
      throw new Error(`Request failed (${res.status}) for ${path}`);
    }
    return (await res.json()) as T;
  }

  async function ensureLoaded(options: { force?: boolean } = {}): Promise<void> {
    if (loaded.value && !options.force) return;
    if (loading.value && !options.force) return;

    loading.value = true;
    error.value = null;
    try {
      me.value = await fetchJson<AccountAuthMe>("/api/v1/auth/me");
      if (!me.value.authenticated) {
        battlenet.value = { linked: false };
        accountChars.value = null;
        loaded.value = true;
        return;
      }

      const [bnet, chars] = await Promise.all([
        fetchJson<BattlenetLinkStatus>("/api/v1/me/battlenet"),
        fetchJson<AccountCharactersResponse>("/api/v1/me/characters"),
      ]);
      battlenet.value = bnet;
      accountChars.value = chars;
      loaded.value = true;
    } catch (err) {
      error.value = (err as Error).message || "Failed to load account characters";
      loaded.value = true;
    } finally {
      loading.value = false;
    }
  }

  function reset(): void {
    me.value = null;
    battlenet.value = null;
    accountChars.value = null;
    loading.value = false;
    error.value = null;
    loaded.value = false;
  }

  return {
    me,
    battlenet,
    accountChars,
    loading,
    error,
    loaded,
    authenticated,
    linked,
    characters,
    hasCharacters,
    showSwitcher,
    ensureLoaded,
    reset,
  };
});
