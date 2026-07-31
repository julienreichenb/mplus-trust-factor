<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { RouterLink, useRouter } from "vue-router";
import type { AccountCharactersResponse, AccountOwnedCharacterDTO } from "@mplus/contracts";
import CharacterIdentity from "../components/character/CharacterIdentity.vue";
import StatusChip from "../components/character/StatusChip.vue";
import TrustTierBadge from "../components/landing/TrustTierBadge.vue";
import type { Grade } from "../api/types";
import { accountCharacterRoute } from "../lib/accountCharacters";

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
    emailMasked?: string | null;
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

const isAdminRole = computed(() =>
  Boolean(me.value?.user?.roles?.some((role) => role.toLowerCase() === "admin")),
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
    message.value = "Ownership refreshed. Analyzing relevant characters…";
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
  return accountCharacterRoute(c);
}
</script>

<template>
  <section class="account-page">
    <header class="header">
      <h1>Account</h1>
      <button type="button" class="btn btn--ghost" @click="signOut">Sign out</button>
    </header>

    <p v-if="message" class="message" role="status">{{ message }}</p>

    <section class="block" data-testid="account-profile">
      <div class="profile-heading">
        <span
          v-if="isAdminRole"
          class="role-chip"
          data-testid="admin-role-chip"
        >ADMIN</span>
        <h2>Profile</h2>
      </div>

      <div class="linked">
        <h3 class="linked__title">Battle.net</h3>
        <template v-if="linked?.linked && linked.account">
          <p class="battletag" data-testid="account-battletag">
            <strong>{{ linked.account.battletag ?? linked.account.providerAccountId }}</strong>
          </p>
          <p
            v-if="linked.account.emailMasked"
            class="email-masked muted"
            data-testid="account-email-masked"
          >
            {{ linked.account.emailMasked }}
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
      </div>
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

      <p v-if="discoveryActive" class="discovering" role="status">Analyzing your characters…</p>

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
              <CharacterIdentity
                :region="c.region"
                :name="c.name"
                :realm-slug="c.realmSlug"
                :realm-name="c.realmName"
                :class-slug="c.characterClass.slug"
                :class-name="c.characterClass.name"
                :class-color="c.characterClass.color"
                :portrait-url="c.media.portraitUrl"
                :size="48"
              />
              <span class="extra-meta muted">
                <template v-if="c.level != null">{{ c.level }}</template>
                <template v-if="c.currentSeasonMythic.rating != null">
                  · {{ Math.round(c.currentSeasonMythic.rating) }} M+
                </template>
              </span>
            </div>

            <div class="char-row__center">
              <StatusChip :status="c.trustScore.status" />
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
            </div>
          </div>

          <div class="char-row__actions">
            <span
              v-if="c.isPrimary"
              class="primary-slot primary-slot--state"
              data-testid="primary-state"
            >Primary</span>
            <button
              v-else
              type="button"
              class="btn btn--ghost primary-slot"
              data-testid="set-primary"
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
.profile-heading {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}
.profile-heading h2 {
  margin: 0;
}
.role-chip {
  display: inline-flex;
  align-items: center;
  padding: 0.2rem 0.55rem;
  border: 1px solid color-mix(in srgb, var(--color-brand) 45%, transparent);
  border-radius: var(--radius-control);
  background: color-mix(in srgb, var(--color-brand) 14%, transparent);
  color: var(--color-brand);
  font-family: var(--font-data);
  font-size: var(--text-xs);
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  line-height: 1.2;
}
.linked {
  display: grid;
  gap: var(--space-2);
}
.linked__title {
  margin: 0;
  font-family: var(--font-data);
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-muted, #a8a8b3);
}
.battletag {
  margin: 0;
}
.email-masked {
  margin: 0;
  font-family: var(--font-data);
  font-size: var(--text-sm);
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
  justify-content: center;
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
  min-height: 2.5rem;
  box-sizing: border-box;
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
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}
.extra-meta {
  font-size: 0.85rem;
  padding-left: calc(48px + var(--space-2));
}
.char-row__center {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.2rem;
  min-width: 0;
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
  flex: 0 0 7.5rem;
  width: 7.5rem;
}
.primary-slot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 7.5rem;
  min-height: 2.5rem;
  box-sizing: border-box;
}
.primary-slot--state {
  border: 1px solid rgb(134 239 172 / 35%);
  border-radius: 0.4rem;
  color: #86efac;
  font-size: 0.85rem;
  font-weight: 600;
  pointer-events: none;
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
  .char-row__actions {
    flex-basis: 100%;
    width: 100%;
  }
  .primary-slot {
    width: 7.5rem;
  }
}
</style>
