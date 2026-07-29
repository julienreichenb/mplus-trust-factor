<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink, useRouter } from "vue-router";

const apiBase = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";
const router = useRouter();

interface OwnedCharacter {
  id: string;
  characterId: string | null;
  blizzardCharacterId: string;
  region: string;
  realmSlug: string;
  name: string;
  status: string;
  isPrimary: boolean;
  verifiedAt: string;
}

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
const characters = ref<OwnedCharacter[]>([]);
const message = ref<string | null>(null);
const confirmUnlink = ref(false);
const busy = ref(false);

const canAdmin = () =>
  Boolean(
    me.value?.user?.permissions?.some(
      (p) => p.startsWith("admin.") || p === "score.recalculate" || p === "admin.ability_catalog.read",
    ),
  );

async function load(): Promise<void> {
  const meRes = await fetch(`${apiBase}/api/v1/auth/me`, { credentials: "include" });
  me.value = await meRes.json();
  if (!me.value?.authenticated) {
    await router.replace("/auth/signin");
    return;
  }
  const [bnetRes, charsRes] = await Promise.all([
    fetch(`${apiBase}/api/v1/me/battlenet`, { credentials: "include" }),
    fetch(`${apiBase}/api/v1/me/characters`, { credentials: "include" }),
  ]);
  linked.value = await bnetRes.json();
  const body = await charsRes.json();
  characters.value = body.characters ?? [];
}

onMounted(() => {
  void load().catch(() => {
    message.value = "Failed to load account.";
  });
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
    await load();
    message.value = "Ownership refreshed from Battle.net.";
  } finally {
    busy.value = false;
  }
}

async function setPrimary(id: string): Promise<void> {
  await fetch(`${apiBase}/api/v1/me/characters/${id}/primary`, {
    method: "POST",
    credentials: "include",
  });
  await load();
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
      <p class="muted">Private list — never shown on public profiles.</p>
      <ul v-if="characters.length" class="char-list">
        <li v-for="c in characters" :key="c.id">
          <div>
            <strong>{{ c.name }}</strong>
            <span class="muted"> — {{ c.realmSlug }} ({{ c.region }}) · {{ c.status }}</span>
            <span v-if="c.isPrimary" class="badge">Primary</span>
          </div>
          <button
            v-if="c.status === 'CURRENT' && !c.isPrimary"
            type="button"
            class="btn btn--ghost"
            @click="setPrimary(c.id)"
          >
            Set primary
          </button>
        </li>
      </ul>
      <p v-else class="muted">No verified characters yet.</p>
    </section>

    <section v-if="canAdmin()" class="block">
      <h2>Admin</h2>
      <nav class="actions">
        <RouterLink class="btn btn--ghost" to="/admin/models">Score models</RouterLink>
        <RouterLink class="btn btn--ghost" to="/admin/ability-catalog">Ability catalog</RouterLink>
      </nav>
    </section>
  </section>
</template>

<style scoped>
.account-page {
  max-width: 44rem;
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
.char-list li {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3) 0;
  border-bottom: 1px solid rgb(255 255 255 / 6%);
}
.badge {
  margin-left: 0.5rem;
  font-size: 0.75rem;
  color: #86efac;
}
.confirm {
  border: 1px solid rgb(248 113 113 / 35%);
  border-radius: 0.5rem;
  padding: var(--space-4);
}
</style>
