<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { RouterLink, useRouter } from "vue-router";
import type { AccountCharactersResponse, AccountOwnedCharacterDTO } from "@mplus/contracts";
import TrustTierBadge from "../components/landing/TrustTierBadge.vue";
import type { Grade } from "../api/types";
import { classIconUrl } from "../lib/wowClass";

const apiBase = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";
const router = useRouter();

const me = ref<{
  authenticated: boolean;
  user?: { id: string; displayName: string | null; roles: string[]; permissions: string[] };
} | null>(null);
const linked = ref<{
  linked: boolean;
  account?: {
    providerAccountId: string;
    battletag: string | null;
    linkedAt: string;
    lastOwnershipSyncAt: string | null;
    lastOwnershipSyncError: string | null;
  };
} | null>(null);
const accountChars = ref<AccountCharactersResponse | null>(null);
const message = ref<string | null>(null);
const confirmUnlink = ref(false);
const busy = ref(false);

let pollTimer: ReturnType<typeof setTimeout> | null = null;
let pollInFlight = false;
let stopped = false;

const canAdmin = () =>
  Boolean(
    me.value?.user?.permissions?.some(
      (p) => p.startsWith("admin.") || p === "score.recalculate" || p === "admin.ability_catalog.read",
    ),
  );

const characters = computed(() => accountChars.value?.characters ?? []);
const discoveryActive = computed(() => {
  const status = accountChars.value?.discovery.status;
  return status === "QUEUED" || status === "RUNNING";
});
const needsPolling = computed(() => {
  if (discoveryActive.value) return true;
  return characters.value.some(
    (c) =>
      c.trustScore.status === "QUEUED" ||
      c.trustScore.status === "RUNNING" ||
      c.trustScore.status === "REFRESHING" ||
      c.trustScore.status === "DISCOVERING",
  );
});

function statusLabel(status: AccountOwnedCharacterDTO["trustScore"]["status"]): string {
  switch (status) {
    case "DISCOVERING":
      return "Discovering";
    case "QUEUED":
      return "Queued";
    case "RUNNING":
      return "Analysing";
    case "REFRESHING":
      return "Actualisation en cours";
    case "AVAILABLE":
      return "Available";
    case "PARTIAL":
      return "Partial data";
    case "FAILED":
      return "Failed";
    case "STALE":
      return "Données à actualiser";
    case "UNAVAILABLE":
      return "Unavailable";
    default:
      return "Not requested";
  }
}

function clearPoll(): void {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

function schedulePoll(): void {
  clearPoll();
  if (stopped || !needsPolling.value) return;
  pollTimer = setTimeout(() => {
    void pollCharacters();
  }, 4000);
}

async function fetchCharactersOnly(): Promise<void> {
  const charsRes = await fetch(`${apiBase}/api/v1/me/characters`, { credentials: "include" });
  accountChars.value = await charsRes.json();
}

async function pollCharacters(): Promise<void> {
  if (stopped || pollInFlight) return;
  pollInFlight = true;
  try {
    await fetchCharactersOnly();
  } catch {
    /* keep polling on transient errors */
  } finally {
    pollInFlight = false;
    schedulePoll();
  }
}

async function load(): Promise<void> {
  const meRes = await fetch(`${apiBase}/api/v1/auth/me`, { credentials: "include" });
  me.value = await meRes.json();
  if (!me.value?.authenticated) {
    await router.replace("/auth/signin");
    return;
  }
  const [bnetRes] = await Promise.all([
    fetch(`${apiBase}/api/v1/me/battlenet`, { credentials: "include" }),
    fetchCharactersOnly(),
  ]);
  linked.value = await bnetRes.json();
  schedulePoll();
}

onMounted(() => {
  stopped = false;
  void load().catch(() => {
    message.value = "Failed to load account.";
  });
});

onBeforeUnmount(() => {
  stopped = true;
  clearPoll();
});

async function refreshOwnership(): Promise<void> {
  busy.value = true;
  message.value = null;
  try {
    const res = await fetch(`${apiBase}/api/v1/me/characters/refresh-ownership`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      message.value = body?.error?.message ?? "Ownership refresh failed";
      return;
    }
    await fetchCharactersOnly();
    schedulePoll();
    message.value = "Ownership refreshed. Analysing relevant characters…";
  } finally {
    busy.value = false;
  }
}

async function setPrimary(ownershipId: string): Promise<void> {
  await fetch(`${apiBase}/api/v1/me/characters/${ownershipId}/primary`, {
    method: "POST",
    credentials: "include",
  });
  await fetchCharactersOnly();
}

async function unlink(): Promise<void> {
  busy.value = true;
  try {
    await fetch(`${apiBase}/api/v1/me/battlenet/unlink`, {
      method: "POST",
      credentials: "include",
    });
    confirmUnlink.value = false;
    await load();
    message.value = "Battle.net account unlinked. Future private sync is disabled.";
  } finally {
    busy.value = false;
  }
}

async function signOut(): Promise<void> {
  await fetch(`${apiBase}/api/v1/auth/logout`, { method: "POST", credentials: "include" });
  await router.push("/auth/signin");
}

function characterRoute(c: AccountOwnedCharacterDTO) {
  return {
    name: "character" as const,
    params: {
      region: c.region.toLowerCase(),
      realm: c.realmSlug,
      name: c.name,
    },
  };
}

function portraitSrc(c: AccountOwnedCharacterDTO): string | null {
  return c.media.portraitUrl ?? classIconUrl(c.characterClass.slug);
}
</script>

<template>
  <section class="account-page">
    <header class="header">
      <h1>Account</h1>
      <button type="button" class="btn btn--ghost" @click="signOut">Sign out</button>
    </header>

    <p v-if="message" class="message" role="status">{{ message }}</p>

    <section class="block">
      <h2>Profile</h2>
      <p>{{ me?.user?.displayName ?? "—" }}</p>
      <p class="muted">Roles: {{ me?.user?.roles?.join(", ") || "none" }}</p>
    </section>

    <section class="block">
      <h2>Linked Battle.net</h2>
      <template v-if="linked?.linked && linked.account">
        <p>
          <strong>{{ linked.account.battletag ?? linked.account.providerAccountId }}</strong>
        </p>
        <p class="muted">Linked {{ new Date(linked.account.linkedAt).toLocaleString() }}</p>
        <p v-if="linked.account.lastOwnershipSyncError" class="error">
          Sync error: {{ linked.account.lastOwnershipSyncError }}
        </p>
        <div class="actions">
          <button type="button" class="btn" :disabled="busy" @click="refreshOwnership">
            Refresh ownership
          </button>
          <button type="button" class="btn btn--danger" :disabled="busy" @click="confirmUnlink = true">
            Unlink
          </button>
        </div>
      </template>
      <template v-else>
        <p class="muted">No Battle.net account linked.</p>
        <RouterLink class="btn" to="/auth/signin">Link Battle.net</RouterLink>
      </template>
    </section>

    <section v-if="confirmUnlink" class="block confirm" role="dialog" aria-labelledby="unlink-title">
      <h2 id="unlink-title">Confirm unlink</h2>
      <p>
        This revokes provider tokens and marks ownership as revoked. Public Trust Scores are
        unchanged. Private ownership sync will stop until you sign in again.
      </p>
      <div class="actions">
        <button type="button" class="btn btn--danger" :disabled="busy" @click="unlink">
          Confirm unlink
        </button>
        <button type="button" class="btn btn--ghost" @click="confirmUnlink = false">Cancel</button>
      </div>
    </section>

    <section class="block">
      <h2>Owned characters</h2>
      <p class="muted">Private list — only relevant max-level characters are shown.</p>

      <p v-if="discoveryActive" class="discovering" role="status">Analysing your characters…</p>

      <p v-if="accountChars" class="counts muted">
        {{ characters.length }} relevant
        <template v-if="accountChars.hiddenCharacterCount > 0">
          · {{ accountChars.hiddenCharacterCount }} hidden (below relevance policy)
        </template>
        · {{ accountChars.totalOwnedCharacterCount }} owned total
      </p>

      <p v-if="accountChars?.primaryDiagnostic" class="diagnostic" role="status">
        {{ accountChars.primaryDiagnostic }}
      </p>

      <ul v-if="characters.length" class="char-list">
        <li v-for="c in characters" :key="c.ownershipId" class="char-row">
          <div class="char-row__body">
            <RouterLink
              class="char-row__link"
              :to="characterRoute(c)"
              :aria-label="`${c.name} on ${c.realmSlug}`"
            />
            <div class="char-row__left">
              <img
                class="portrait"
                :src="portraitSrc(c) ?? undefined"
                :alt="`${c.name} portrait`"
                width="48"
                height="48"
              />
              <div class="identity">
                <span
                  class="name"
                  :style="c.characterClass.color ? { color: c.characterClass.color } : undefined"
                >
                  {{ c.name }}
                </span>
                <span class="meta muted">
                  {{ c.realmName ?? c.realmSlug }} · {{ c.region }}
                  <template v-if="c.level != null"> · {{ c.level }}</template>
                  <template v-if="c.currentSeasonMythic.rating != null">
                    · {{ Math.round(c.currentSeasonMythic.rating) }} M+
                  </template>
                </span>
              </div>
            </div>

            <div class="char-row__center">
              <span class="lifecycle" :data-status="c.trustScore.status">
                {{ statusLabel(c.trustScore.status) }}
              </span>
              <span
                v-if="c.trustScore.errorMessage && (c.trustScore.status === 'FAILED' || c.trustScore.status === 'STALE' || c.trustScore.status === 'AVAILABLE')"
                class="fail-reason"
              >
                {{ c.trustScore.errorMessage }}
              </span>
            </div>

            <div class="char-row__right">
              <TrustTierBadge
                v-if="
                  (c.trustScore.status === 'AVAILABLE' ||
                    c.trustScore.status === 'REFRESHING' ||
                    c.trustScore.status === 'STALE' ||
                    c.trustScore.status === 'FAILED') &&
                  c.trustScore.grade
                "
                :tier="(c.trustScore.grade as Grade)"
                size="sm"
                letter-only
                flush
              />
              <span
                v-if="
                  c.trustScore.status === 'QUEUED' ||
                  c.trustScore.status === 'RUNNING' ||
                  c.trustScore.status === 'REFRESHING' ||
                  c.trustScore.status === 'DISCOVERING'
                "
                class="spinner"
                aria-hidden="true"
              />
              <span
                v-else-if="
                  !(
                    (c.trustScore.status === 'AVAILABLE' ||
                      c.trustScore.status === 'STALE' ||
                      c.trustScore.status === 'FAILED') &&
                    c.trustScore.grade
                  )
                "
                class="status-pill"
                :data-status="c.trustScore.status"
              >
                {{ statusLabel(c.trustScore.status) }}
              </span>
              <span v-if="c.isPrimary" class="badge">Primary</span>
            </div>
          </div>

          <div class="char-row__actions">
            <button
              v-if="!c.isPrimary"
              type="button"
              class="btn btn--ghost"
              @click.prevent.stop="setPrimary(c.ownershipId)"
            >
              Set primary
            </button>
          </div>
        </li>
      </ul>

      <p v-else-if="accountChars && !discoveryActive" class="muted empty">
        No characters meet the relevance policy yet. Link Battle.net and refresh ownership after
        reaching max level with Mythic+ activity, or set a primary character.
      </p>
      <p v-else-if="!accountChars" class="muted">Loading characters…</p>
    </section>

    <section v-if="canAdmin()" class="block">
      <h2>Admin</h2>
      <nav class="actions">
        <RouterLink class="btn btn--ghost" to="/admin/models">Score models</RouterLink>
        <RouterLink class="btn btn--ghost" to="/admin/ability-catalog">Ability catalog</RouterLink>
        <RouterLink class="btn btn--ghost" to="/admin/users">Admin users</RouterLink>
      </nav>
    </section>
  </section>
</template>

<style scoped>
.account-page {
  max-width: 52rem;
  margin: 0 auto;
  padding: var(--space-6) var(--space-4);
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-3);
}
.block {
  margin-top: var(--space-6);
  padding-top: var(--space-4);
  border-top: 1px solid rgb(255 255 255 / 10%);
}
.muted {
  color: var(--color-text-muted, #a8a8b3);
}
.error {
  color: #f87171;
}
.message {
  margin-top: var(--space-3);
  color: #86efac;
}
.discovering {
  margin: var(--space-3) 0;
  color: #93c5fd;
}
.counts {
  margin: var(--space-2) 0 var(--space-3);
  font-size: 0.9rem;
}
.diagnostic {
  margin-bottom: var(--space-3);
  color: #fbbf24;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  margin-top: var(--space-3);
}
.btn {
  display: inline-flex;
  align-items: center;
  padding: 0.55rem 0.9rem;
  border-radius: 0.4rem;
  border: 1px solid rgb(255 255 255 / 16%);
  background: #1f6feb;
  color: #fff;
  text-decoration: none;
  cursor: pointer;
  font: inherit;
  position: relative;
  z-index: 1;
}
.btn--ghost {
  background: transparent;
}
.btn--danger {
  background: #b91c1c;
}
.char-list {
  list-style: none;
  padding: 0;
  margin: var(--space-3) 0 0;
}
.char-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) 0;
  border-bottom: 1px solid rgb(255 255 255 / 6%);
}
.char-row__body {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) auto;
  gap: var(--space-3);
  align-items: center;
  flex: 1;
  min-width: 0;
}
.char-row__link {
  position: absolute;
  inset: 0;
  z-index: 0;
  border-radius: 0.35rem;
}
.char-row__link:focus-visible {
  outline: 2px solid #93c5fd;
  outline-offset: 2px;
}
.char-row__left {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
}
.portrait {
  width: 48px;
  height: 48px;
  border-radius: 0.35rem;
  object-fit: cover;
  background: rgb(255 255 255 / 6%);
  flex-shrink: 0;
}
.identity {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
}
.name {
  font-weight: 650;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meta {
  font-size: 0.85rem;
}
.char-row__center {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}
.lifecycle {
  font-size: 0.9rem;
}
.lifecycle[data-status="FAILED"] {
  color: #f87171;
}
.fail-reason {
  font-size: 0.8rem;
  color: #fca5a5;
}
.char-row__right {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  justify-content: flex-end;
}
.char-row__actions {
  position: relative;
  z-index: 1;
}
.badge {
  font-size: 0.75rem;
  color: #86efac;
}
.status-pill {
  font-size: 0.8rem;
  color: var(--color-text-muted, #a8a8b3);
}
.spinner {
  width: 1rem;
  height: 1rem;
  border: 2px solid rgb(255 255 255 / 20%);
  border-top-color: #93c5fd;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.confirm {
  border: 1px solid rgb(248 113 113 / 35%);
  border-radius: 0.5rem;
  padding: var(--space-4);
}
.empty {
  margin-top: var(--space-3);
}
@media (max-width: 720px) {
  .char-row__body {
    grid-template-columns: 1fr;
  }
  .char-row__right {
    justify-content: flex-start;
  }
}
</style>
