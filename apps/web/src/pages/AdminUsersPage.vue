<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { ApiClientError } from "../api/live-client";
import StatusBanner from "../components/common/StatusBanner.vue";
import { useAuthSession } from "../composables/useAuthSession";

const apiBase = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";
const router = useRouter();
const { canManageUsers, hasPermission, fetchAuthMe } = useAuthSession();

type TabKey = "accounts" | "characters" | "refresh-jobs";
const activeTab = ref<TabKey>("accounts");
const canManageJobs = computed(() => hasPermission("admin.jobs.manage"));

interface AdminUserRow {
  id: string;
  displayName: string | null;
  email: string | null;
  roles: string[];
  battlenet: { subject: string | null; battletag: string | null };
}

interface AdminCharacterRow {
  id: string;
  region: string;
  realmSlug: string;
  name: string;
  classSlug: string | null;
  classColor: string | null;
  avatarUrl: string | null;
  classIconUrl: string | null;
  mythicPlusScore: number | null;
  refreshStatus: string | null;
  refreshJobId: string | null;
}

interface AdminRefreshJobRow {
  id: string;
  characterId: string | null;
  region: string | null;
  realmSlug: string | null;
  name: string | null;
  classSlug: string | null;
  classColor: string | null;
  avatarUrl: string | null;
  classIconUrl: string | null;
  mythicPlusScore: number | null;
  databaseStatus: string;
  queueState: string;
  triggerSource: string | null;
  fromBulk: boolean;
  priority: number;
  retryable: boolean;
  latestError: { code: string | null; message: string | null } | null;
  cancelRequested: boolean;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  actions: { rerun: boolean; prioritize: boolean; cancel: boolean };
}

const message = ref<string | null>(null);
const error = ref<string | null>(null);
const busy = ref(false);

// Accounts
const query = ref("");
const users = ref<AdminUserRow[]>([]);
const roles = ref<Array<{ key: string; name: string }>>([]);
const allowLastAdminRemoval = ref(false);

// Characters
const charRegion = ref("EU");
const charNickname = ref("");
const charRealm = ref("");
const characters = ref<AdminCharacterRow[]>([]);

// Refresh jobs
const jobs = ref<AdminRefreshJobRow[]>([]);
const jobsTotal = ref(0);
const jobsPage = ref(1);
const jobsPageSize = ref(25);
const jobStatus = ref("");
const jobRegion = ref("");
const jobCharacter = ref("");
const jobTrigger = ref("");
const jobFromBulk = ref("");
const showHistoricalFailures = ref(false);
const inFlightCount = ref(0);
const killConfirm = ref(false);
const actionBusyId = ref<string | null>(null);

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

function formatTs(value: string | null): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

async function loadRoles(): Promise<void> {
  const body = await apiJson<{ roles: Array<{ key: string; name: string }> }>("/api/v1/admin/roles");
  roles.value = body.roles;
}

async function searchUsers(): Promise<void> {
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
    await searchUsers();
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
    await searchUsers();
  } catch (err) {
    if (!handleAuthError(err)) error.value = (err as Error).message;
  } finally {
    busy.value = false;
  }
}

async function searchCharacters(): Promise<void> {
  const nickname = charNickname.value.trim();
  if (nickname.length < 2) {
    error.value = "Enter at least 2 characters for nickname.";
    return;
  }
  busy.value = true;
  error.value = null;
  message.value = null;
  try {
    const params = new URLSearchParams({
      nickname,
      ...(charRegion.value ? { region: charRegion.value } : {}),
      ...(charRealm.value.trim() ? { realm: charRealm.value.trim() } : {}),
    });
    const body = await apiJson<{ characters: AdminCharacterRow[] }>(
      `/api/v1/admin/refresh-jobs/characters/search?${params}`,
    );
    characters.value = body.characters;
    if (body.characters.length === 0) message.value = "No characters matched.";
  } catch (err) {
    if (!handleAuthError(err)) error.value = (err as Error).message;
  } finally {
    busy.value = false;
  }
}

async function loadJobCount(): Promise<void> {
  const body = await apiJson<{ count: number }>("/api/v1/admin/refresh-jobs/count");
  inFlightCount.value = body.count;
}

async function loadJobs(): Promise<void> {
  busy.value = true;
  error.value = null;
  try {
    const params = new URLSearchParams({
      page: String(jobsPage.value),
      pageSize: String(jobsPageSize.value),
      showHistoricalFailures: showHistoricalFailures.value ? "true" : "false",
    });
    if (jobStatus.value) params.set("status", jobStatus.value);
    if (jobRegion.value) params.set("region", jobRegion.value);
    if (jobCharacter.value.trim()) params.set("characterName", jobCharacter.value.trim());
    if (jobTrigger.value) params.set("triggerSource", jobTrigger.value);
    if (jobFromBulk.value === "true" || jobFromBulk.value === "false") {
      params.set("fromBulk", jobFromBulk.value);
    }
    const body = await apiJson<{
      jobs: AdminRefreshJobRow[];
      total: number;
      page: number;
      pageSize: number;
    }>(`/api/v1/admin/refresh-jobs?${params}`);
    jobs.value = body.jobs;
    jobsTotal.value = body.total;
    jobsPage.value = body.page;
    await loadJobCount();
  } catch (err) {
    if (!handleAuthError(err)) error.value = (err as Error).message;
  } finally {
    busy.value = false;
  }
}

async function jobAction(id: string, action: "cancel" | "prioritize" | "rerun"): Promise<void> {
  if (actionBusyId.value) return;
  actionBusyId.value = id;
  error.value = null;
  message.value = null;
  try {
    await apiJson(`/api/v1/admin/refresh-jobs/${encodeURIComponent(id)}/${action}`, {
      method: "POST",
      body: "{}",
    });
    message.value = `Job ${action} succeeded.`;
    await loadJobs();
  } catch (err) {
    if (!handleAuthError(err)) error.value = (err as Error).message;
  } finally {
    actionBusyId.value = null;
  }
}

async function killAll(): Promise<void> {
  if (!killConfirm.value || actionBusyId.value) return;
  actionBusyId.value = "kill-all";
  error.value = null;
  message.value = null;
  try {
    const body = await apiJson<{
      queuedCancelled: number;
      delayedCancelled: number;
      activeCancellationRequested: number;
      alreadyCancellationRequested: number;
      alreadyTerminal: number;
      cancellationFailed: number;
      countBefore: number;
    }>("/api/v1/admin/refresh-jobs/kill-all", {
      method: "POST",
      body: JSON.stringify({ confirm: true }),
    });
    message.value = `Kill all (point-in-time): queued ${body.queuedCancelled}, delayed ${body.delayedCancelled}, active requested ${body.activeCancellationRequested}, already requested ${body.alreadyCancellationRequested}, already terminal ${body.alreadyTerminal}, failed ${body.cancellationFailed} (snapshot ${body.countBefore}). Bulk may still enqueue new refreshes unless paused.`;
    killConfirm.value = false;
    await loadJobs();
  } catch (err) {
    if (!handleAuthError(err)) error.value = (err as Error).message;
  } finally {
    actionBusyId.value = null;
  }
}

const totalPages = computed(() => Math.max(1, Math.ceil(jobsTotal.value / jobsPageSize.value)));

watch(activeTab, (tab) => {
  error.value = null;
  message.value = null;
  if (tab === "refresh-jobs" && canManageJobs.value) {
    void loadJobs();
  }
});

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
  <section class="admin-ops">
    <header class="header">
      <h1>Admin operations</h1>
      <p class="muted">Accounts, persisted characters, and refresh-job control.</p>
    </header>

    <nav class="tabs" aria-label="Admin sections">
      <button
        type="button"
        class="tab"
        :class="{ 'tab--active': activeTab === 'accounts' }"
        data-testid="tab-accounts"
        @click="activeTab = 'accounts'"
      >
        Accounts
      </button>
      <button
        type="button"
        class="tab"
        :class="{ 'tab--active': activeTab === 'characters' }"
        data-testid="tab-characters"
        @click="activeTab = 'characters'"
      >
        Characters
      </button>
      <button
        type="button"
        class="tab"
        :class="{ 'tab--active': activeTab === 'refresh-jobs' }"
        data-testid="tab-refresh-jobs"
        @click="activeTab = 'refresh-jobs'"
      >
        Refresh jobs
      </button>
    </nav>

    <StatusBanner v-if="error" tone="error" :message="error" />
    <StatusBanner v-else-if="message" tone="success" :message="message" />

    <!-- Accounts -->
    <div v-if="activeTab === 'accounts'" data-testid="panel-accounts">
      <p class="muted">
        Search by BattleTag or email. Authorization uses immutable user ID / Battle.net subject only.
      </p>
      <form class="search" @submit.prevent="searchUsers">
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
      <p v-if="roles.length" class="muted roles">
        Manageable roles: {{ roles.map((r) => r.key).join(", ") }}
      </p>
    </div>

    <!-- Characters -->
    <div v-else-if="activeTab === 'characters'" data-testid="panel-characters">
      <form class="search search--grid" @submit.prevent="searchCharacters">
        <label>
          <span class="label">Region</span>
          <select v-model="charRegion">
            <option value="EU">EU</option>
            <option value="US">US</option>
            <option value="KR">KR</option>
            <option value="TW">TW</option>
          </select>
        </label>
        <label>
          <span class="label">Nickname</span>
          <input v-model="charNickname" type="search" autocomplete="off" placeholder="Character" />
        </label>
        <label>
          <span class="label">Realm / server</span>
          <input v-model="charRealm" type="search" autocomplete="off" placeholder="tarren-mill" />
        </label>
        <button type="submit" class="btn" :disabled="busy">Search</button>
      </form>

      <ul class="results" data-testid="admin-characters-results">
        <li v-for="c in characters" :key="c.id" class="char-row">
          <img
            v-if="c.avatarUrl"
            class="portrait"
            :src="c.avatarUrl"
            :alt="c.name"
            width="40"
            height="40"
          />
          <img
            v-else-if="c.classIconUrl"
            class="portrait"
            :src="c.classIconUrl"
            :alt="c.classSlug ?? 'class'"
            width="40"
            height="40"
          />
          <div v-else class="portrait portrait--empty" aria-hidden="true" />
          <div>
            <p class="muted">{{ c.region }}</p>
            <strong :style="c.classColor ? { color: c.classColor } : undefined">
              {{ c.name }}-{{ c.realmSlug }}
            </strong>
            <p class="muted">
              M+ score: {{ c.mythicPlusScore != null ? Math.round(c.mythicPlusScore) : "—" }} · refresh:
              {{ c.refreshStatus ?? "—" }}
            </p>
          </div>
        </li>
      </ul>
    </div>

    <!-- Refresh jobs -->
    <div v-else data-testid="panel-refresh-jobs">
      <div v-if="!canManageJobs" class="muted">Requires admin.jobs.manage permission.</div>
      <template v-else>
        <div class="kill-all">
          <p class="muted">
            Cancels queued/delayed refresh-character jobs and requests cooperative cancellation for
            active ones in this environment only. Does not touch ownership discovery, bulk
            orchestrator, or addon jobs.
          </p>
          <label class="override">
            <input v-model="killConfirm" type="checkbox" />
            I understand this is destructive
          </label>
          <button
            type="button"
            class="btn btn--danger"
            data-testid="kill-all-refresh"
            :disabled="!killConfirm || Boolean(actionBusyId)"
            @click="killAll"
          >
            Kill all refresh jobs ({{ inFlightCount }})
          </button>
        </div>

        <form class="search search--grid" @submit.prevent="loadJobs">
          <label>
            <span class="label">Status</span>
            <select v-model="jobStatus">
              <option value="">Any</option>
              <option value="QUEUED">Queued</option>
              <option value="ACTIVE">Active</option>
              <option value="FAILED">Failed</option>
              <option value="COMPLETED">Completed</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </label>
          <label>
            <span class="label">Region</span>
            <input v-model="jobRegion" type="text" placeholder="EU" />
          </label>
          <label>
            <span class="label">Character</span>
            <input v-model="jobCharacter" type="text" placeholder="name" />
          </label>
          <label>
            <span class="label">Trigger</span>
            <select v-model="jobTrigger">
              <option value="">Any</option>
              <option value="PROFILE_READ">PROFILE_READ</option>
              <option value="MANUAL_REFRESH">MANUAL_REFRESH</option>
              <option value="MANUAL_FORCE_REFRESH">MANUAL_FORCE_REFRESH</option>
              <option value="ACCOUNT_DISCOVERY">ACCOUNT_DISCOVERY</option>
              <option value="BULK_REFRESH">BULK_REFRESH</option>
              <option value="SYSTEM">SYSTEM</option>
            </select>
          </label>
          <label>
            <span class="label">Bulk vs direct</span>
            <select v-model="jobFromBulk">
              <option value="">Any</option>
              <option value="true">Bulk</option>
              <option value="false">Direct</option>
            </select>
          </label>
          <label class="override">
            <input v-model="showHistoricalFailures" type="checkbox" />
            Show historical failures
          </label>
          <button type="submit" class="btn" :disabled="busy">Apply filters</button>
        </form>

        <ul class="results" data-testid="admin-refresh-jobs-results">
          <li v-for="job in jobs" :key="job.id" class="job-row">
            <img
              v-if="job.avatarUrl"
              class="portrait"
              :src="job.avatarUrl"
              :alt="job.name ?? 'character'"
              width="40"
              height="40"
            />
            <img
              v-else-if="job.classIconUrl"
              class="portrait"
              :src="job.classIconUrl"
              alt="class"
              width="40"
              height="40"
            />
            <div v-else class="portrait portrait--empty" aria-hidden="true" />
            <div class="job-main">
              <p class="muted">{{ job.region ?? "—" }}</p>
              <strong :style="job.classColor ? { color: job.classColor } : undefined">
                {{ job.name ?? "?" }}-{{ job.realmSlug ?? "?" }}
              </strong>
              <p class="muted mono">job: {{ job.id }}</p>
              <p class="muted">
                queue {{ job.queueState }} · db {{ job.databaseStatus }}
                <span v-if="job.cancelRequested"> · cancel requested</span>
                · trigger {{ job.triggerSource ?? "—" }}
                · {{ job.fromBulk ? "bulk" : "direct" }}
                · prio {{ job.priority }}
              </p>
              <p class="muted">
                created {{ formatTs(job.createdAt) }} · started {{ formatTs(job.startedAt) }} ·
                finished {{ formatTs(job.finishedAt) }}
              </p>
              <p v-if="job.latestError" class="error-line">
                {{ job.latestError.code ?? "ERROR" }}: {{ job.latestError.message }}
                <span v-if="job.retryable"> (retryable)</span>
              </p>
            </div>
            <div class="actions">
              <button
                v-if="job.actions.rerun"
                type="button"
                class="btn"
                :disabled="Boolean(actionBusyId)"
                @click="jobAction(job.id, 'rerun')"
              >
                Re-run
              </button>
              <button
                v-if="job.actions.prioritize"
                type="button"
                class="btn"
                :disabled="Boolean(actionBusyId)"
                @click="jobAction(job.id, 'prioritize')"
              >
                Prioritize
              </button>
              <button
                v-if="job.actions.cancel"
                type="button"
                class="btn btn--danger"
                :disabled="Boolean(actionBusyId)"
                @click="jobAction(job.id, 'cancel')"
              >
                Cancel
              </button>
            </div>
          </li>
        </ul>

        <div class="pager">
          <button
            type="button"
            class="btn"
            :disabled="jobsPage <= 1 || busy"
            @click="jobsPage -= 1; loadJobs()"
          >
            Previous
          </button>
          <span class="muted">Page {{ jobsPage }} / {{ totalPages }} ({{ jobsTotal }})</span>
          <button
            type="button"
            class="btn"
            :disabled="jobsPage >= totalPages || busy"
            @click="jobsPage += 1; loadJobs()"
          >
            Next
          </button>
        </div>
      </template>
    </div>
  </section>
</template>

<style scoped>
.admin-ops {
  max-width: 64rem;
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
.tabs {
  display: flex;
  gap: 0.35rem;
  margin: var(--space-4) 0;
  flex-wrap: wrap;
}
.tab {
  padding: 0.55rem 0.9rem;
  border: 1px solid rgb(255 255 255 / 14%);
  background: transparent;
  color: inherit;
  border-radius: 0.35rem;
  cursor: pointer;
}
.tab--active {
  background: rgb(255 255 255 / 10%);
  border-color: rgb(255 255 255 / 28%);
}
.search {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  align-items: end;
  margin: var(--space-4) 0;
}
.search--grid label,
.search label {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  flex: 1;
  min-width: 10rem;
}
.search input,
.search select {
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
.user-card,
.char-row,
.job-row {
  display: flex;
  justify-content: space-between;
  gap: var(--space-4);
  flex-wrap: wrap;
  padding: var(--space-4);
  border: 1px solid rgb(255 255 255 / 12%);
  border-radius: 0.5rem;
  align-items: flex-start;
}
.char-row,
.job-row {
  justify-content: flex-start;
}
.portrait {
  width: 40px;
  height: 40px;
  border-radius: 0.35rem;
  object-fit: cover;
  flex-shrink: 0;
}
.portrait--empty {
  background: rgb(255 255 255 / 8%);
}
.job-main {
  flex: 1;
  min-width: 14rem;
}
.actions {
  display: flex;
  gap: var(--space-2);
  align-items: start;
  flex-wrap: wrap;
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
.kill-all {
  padding: var(--space-4);
  border: 1px solid rgb(185 28 28 / 45%);
  border-radius: 0.5rem;
  background: rgb(185 28 28 / 10%);
  margin-bottom: var(--space-4);
}
.error-line {
  color: #fca5a5;
  font-size: 0.9rem;
}
.pager {
  display: flex;
  gap: var(--space-3);
  align-items: center;
  margin-top: var(--space-4);
}
</style>
