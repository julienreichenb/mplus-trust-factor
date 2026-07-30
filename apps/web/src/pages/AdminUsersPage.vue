<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ApiClientError } from "../api/live-client";
import StatusBanner from "../components/common/StatusBanner.vue";
import { useAuthSession } from "../composables/useAuthSession";

const apiBase = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";
const router = useRouter();
const { canManageUsers, fetchAuthMe } = useAuthSession();

interface AdminUserRow {
  id: string;
  displayName: string | null;
  email: string | null;
  roles: string[];
  battlenet: { subject: string | null; battletag: string | null };
}

const query = ref("");
const users = ref<AdminUserRow[]>([]);
const roles = ref<Array<{ key: string; name: string }>>([]);
const message = ref<string | null>(null);
const error = ref<string | null>(null);
const busy = ref(false);
const allowLastAdminRemoval = ref(false);

function handleAuthError(err: unknown): boolean {
  if (err instanceof ApiClientError && (err.status === 401 || err.status === 403)) {
    void router.replace(err.status === 401 ? "/auth/signin" : "/access-denied");
    return true;
  }
  return false;
}

async function apiJson<T>(
  path: string,
  init?: { method?: string; body?: string; headers?: Record<string, string> },
): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    credentials: "include",
    method: init?.method,
    body: init?.body,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const envelope = body as { error?: { message?: string; code?: string } } | null;
    throw new ApiClientError(
      envelope?.error?.message ?? `Request failed (${response.status})`,
      response.status,
      envelope?.error?.code ?? "REQUEST_FAILED",
    );
  }
  return body as T;
}

async function loadRoles(): Promise<void> {
  const body = await apiJson<{ roles: Array<{ key: string; name: string }> }>("/api/v1/admin/roles");
  roles.value = body.roles;
}

async function search(): Promise<void> {
  const q = query.value.trim();
  if (q.length < 2) {
    error.value = "Enter at least 2 characters (BattleTag or email).";
    return;
  }
  busy.value = true;
  error.value = null;
  message.value = null;
  try {
    const body = await apiJson<{ users: AdminUserRow[] }>(
      `/api/v1/admin/users?q=${encodeURIComponent(q)}`,
    );
    users.value = body.users;
    if (body.users.length === 0) message.value = "No users matched.";
  } catch (err) {
    if (!handleAuthError(err)) error.value = (err as Error).message;
  } finally {
    busy.value = false;
  }
}

async function grantAdmin(userId: string): Promise<void> {
  if (!canManageUsers.value) return;
  busy.value = true;
  error.value = null;
  try {
    await apiJson(`/api/v1/admin/users/${encodeURIComponent(userId)}/roles`, {
      method: "POST",
      body: JSON.stringify({ roleKey: "admin" }),
    });
    message.value = "Admin role granted.";
    await search();
  } catch (err) {
    if (!handleAuthError(err)) error.value = (err as Error).message;
  } finally {
    busy.value = false;
  }
}

async function revokeAdmin(userId: string): Promise<void> {
  if (!canManageUsers.value) return;
  busy.value = true;
  error.value = null;
  try {
    const qs = allowLastAdminRemoval.value ? "?allowLastAdminRemoval=true" : "";
    await apiJson(`/api/v1/admin/users/${encodeURIComponent(userId)}/roles/admin${qs}`, {
      method: "DELETE",
    });
    message.value = "Admin role revoked.";
    await search();
  } catch (err) {
    if (!handleAuthError(err)) error.value = (err as Error).message;
  } finally {
    busy.value = false;
  }
}

onMounted(async () => {
  await fetchAuthMe();
  try {
    await loadRoles();
  } catch (err) {
    if (!handleAuthError(err)) error.value = (err as Error).message;
  }
});
</script>

<template>
  <section class="admin-users">
    <header class="header">
      <h1>Admin users</h1>
      <p class="muted">
        Search by BattleTag or email. Authorization uses immutable user ID / Battle.net subject only —
        tokens are never shown.
      </p>
    </header>

    <StatusBanner v-if="error" tone="error" :message="error" />
    <StatusBanner v-else-if="message" tone="success" :message="message" />

    <form class="search" @submit.prevent="search">
      <label>
        <span class="label">BattleTag or email</span>
        <input v-model="query" type="search" name="q" autocomplete="off" placeholder="Name#1234" />
      </label>
      <button type="submit" class="btn" :disabled="busy">Search</button>
    </form>

    <label v-if="canManageUsers" class="override">
      <input v-model="allowLastAdminRemoval" type="checkbox" />
      Allow removing the last active admin (explicit override)
    </label>

    <ul class="results" data-testid="admin-users-results">
      <li v-for="user in users" :key="user.id" class="user-card">
        <div>
          <strong>{{ user.battlenet.battletag ?? user.displayName ?? "Unknown" }}</strong>
          <p class="muted mono">user id: {{ user.id }}</p>
          <p class="muted mono">bnet subject: {{ user.battlenet.subject ?? "—" }}</p>
          <p class="muted">email: {{ user.email ?? "—" }}</p>
          <p>roles: {{ user.roles.join(", ") || "none" }}</p>
        </div>
        <div v-if="canManageUsers" class="actions">
          <button
            v-if="!user.roles.includes('admin')"
            type="button"
            class="btn"
            :disabled="busy"
            @click="grantAdmin(user.id)"
          >
            Grant admin
          </button>
          <button
            v-else
            type="button"
            class="btn btn--danger"
            :disabled="busy"
            @click="revokeAdmin(user.id)"
          >
            Revoke admin
          </button>
        </div>
      </li>
    </ul>

    <p v-if="roles.length" class="muted roles">Manageable roles: {{ roles.map((r) => r.key).join(", ") }}</p>
  </section>
</template>

<style scoped>
.admin-users {
  max-width: 52rem;
  margin: 0 auto;
  padding: var(--space-6) var(--space-4);
}
.muted {
  color: var(--color-text-muted, #a8a8b3);
}
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.85em;
}
.search {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  align-items: end;
  margin: var(--space-4) 0;
}
.search label {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  flex: 1;
  min-width: 14rem;
}
.search input {
  padding: 0.6rem 0.75rem;
  border-radius: 0.4rem;
  border: 1px solid rgb(255 255 255 / 16%);
  background: rgb(0 0 0 / 25%);
  color: inherit;
}
.override {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  margin-bottom: var(--space-4);
  font-size: 0.9rem;
}
.results {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.user-card {
  display: flex;
  justify-content: space-between;
  gap: var(--space-4);
  flex-wrap: wrap;
  padding: var(--space-4);
  border: 1px solid rgb(255 255 255 / 12%);
  border-radius: 0.5rem;
}
.actions {
  display: flex;
  gap: var(--space-2);
  align-items: start;
}
.btn {
  display: inline-flex;
  padding: 0.65rem 1rem;
  border-radius: 0.4rem;
  border: none;
  background: #1f6feb;
  color: #fff;
  cursor: pointer;
}
.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.btn--danger {
  background: #b91c1c;
}
.roles {
  margin-top: var(--space-5);
}
</style>
