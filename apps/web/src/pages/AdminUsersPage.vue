<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { api } from "../api/client";
import { ApiClientError } from "../api/live-client";
import type { RealmOption, RegionCode } from "../api/types";
import CharacterIdentity from "../components/character/CharacterIdentity.vue";
import StatusChip from "../components/character/StatusChip.vue";
import HelpTooltip from "../components/common/HelpTooltip.vue";
import StatusBanner from "../components/common/StatusBanner.vue";
import { useAuthSession } from "../composables/useAuthSession";
import { canonicalCharacterPath } from "../lib/format";

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
  battleTag: string | null;
  battleNetEmail: string | null;
  scoringModelKey: string | null;
  scoringModelVersion: number | null;
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
  actions: { rerun: boolean; repairBootstrap: boolean; prioritize: boolean; cancel: boolean };
}

const message = ref<string | null>(null);
const error = ref<string | null>(null);
const busy = ref(false);

const query = ref("");
const users = ref<AdminUserRow[]>([]);
const roles = ref<Array<{ key: string; name: string }>>([]);
const allowLastAdminRemoval = ref(false);

const charRegion = ref("EU");
const charNickname = ref("");
const charRealm = ref("");
const characters = ref<AdminCharacterRow[]>([]);
const charRealms = ref<RealmOption[]>([]);
const charRealmsLoading = ref(false);
let charRealmsAbort: AbortController | null = null;

async function loadCharacterRealms(): Promise<void> {
  charRealmsAbort?.abort();
  charRealmsAbort = new AbortController();
  const signal = charRealmsAbort.signal;
  const region = charRegion.value as RegionCode;
  const previousSlug = charRealm.value;
  charRealmsLoading.value = true;
  try {
    const realms = await api.searchRealms(region, "", signal, 500);
    if (signal.aborted) return;
    charRealms.value = [...realms].sort((a, b) => a.name.localeCompare(b.name));
    if (previousSlug && !charRealms.value.some((r) => r.slug === previousSlug)) {
      charRealm.value = "";
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    if (!handleAuthError(err)) {
      charRealms.value = [];
      error.value = (err as Error).message;
    }
  } finally {
    if (!signal.aborted) charRealmsLoading.value = false;
  }
}

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
/** Monotonic token so a slow list response cannot overwrite a newer loadJobs / local patch. */
let jobsLoadGeneration = 0;

const historicalFailuresHelp =
  "When unchecked, only the latest FAILED job per character is listed. When checked, all past FAILED rows for matching characters are included.";

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

function characterRoute(job: Pick<AdminRefreshJobRow, "region" | "realmSlug" | "name">) {
  if (!job.region || !job.realmSlug || !job.name) return null;
  const path = canonicalCharacterPath(job.region, job.realmSlug, job.name);
  return {
    name: "character" as const,
    params: {
      region: path.region.toLowerCase(),
      realm: path.realm,
      name: path.name,
    },
  };
}

function formatModelVersion(job: AdminRefreshJobRow): string {
  if (job.scoringModelKey && job.scoringModelVersion != null) {
    return `${job.scoringModelKey}@${job.scoringModelVersion}`;
  }
  if (job.scoringModelVersion != null) return `v${job.scoringModelVersion}`;
  if (job.scoringModelKey) return job.scoringModelKey;
  return "—";
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

function queueStateForStatus(status: string): string {
  if (status === "QUEUED") return "queued";
  if (status === "ACTIVE") return "active";
  return status.toLowerCase();
}

function applyCancelResultToJob(
  id: string,
  result: {
    databaseStatus: string;
    outcome: string;
  },
): void {
  const terminalCancel =
    result.databaseStatus === "CANCELLED" ||
    result.outcome === "queued_cancelled" ||
    result.outcome === "delayed_cancelled" ||
    result.outcome === "active_force_cancelled";
  const cancelRequested =
    terminalCancel ||
    result.outcome === "active_cancel_requested" ||
    result.outcome === "already_cancellation_requested" ||
    result.outcome === "already_terminal";

  jobs.value = jobs.value.map((job) => {
    if (job.id !== id) return job;
    const databaseStatus =
      result.databaseStatus && result.databaseStatus !== "MISSING" && result.databaseStatus !== "UNKNOWN"
        ? result.databaseStatus
        : job.databaseStatus;
    const cancelled = databaseStatus === "CANCELLED";
    return {
      ...job,
      databaseStatus,
      queueState: queueStateForStatus(databaseStatus),
      cancelRequested: cancelRequested || job.cancelRequested,
      finishedAt: cancelled ? (job.finishedAt ?? new Date().toISOString()) : job.finishedAt,
      actions: {
        repairBootstrap: false,
        rerun: cancelled || databaseStatus === "FAILED" || databaseStatus === "COMPLETED",
        prioritize: databaseStatus === "QUEUED" && !cancelRequested,
        cancel:
          (databaseStatus === "QUEUED" || databaseStatus === "ACTIVE") &&
          !cancelled &&
          result.outcome !== "active_cancel_requested" &&
          result.outcome !== "already_cancellation_requested",
      },
    };
  });
}

async function loadJobs(): Promise<void> {
  const generation = ++jobsLoadGeneration;
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
    if (generation !== jobsLoadGeneration) return;
    jobs.value = body.jobs;
    jobsTotal.value = body.total;
    jobsPage.value = body.page;
    await loadJobCount();
  } catch (err) {
    if (generation !== jobsLoadGeneration) return;
    if (!handleAuthError(err)) error.value = (err as Error).message;
  } finally {
    if (generation === jobsLoadGeneration) busy.value = false;
  }
}

async function jobAction(
  id: string,
  action: "cancel" | "prioritize" | "rerun" | "repairBootstrap",
): Promise<void> {
  if (actionBusyId.value) return;
  actionBusyId.value = id;
  error.value = null;
  message.value = null;
  try {
    if (action === "cancel") {
      const result = await apiJson<{
        databaseStatus: string;
        outcome: string;
        message?: string;
      }>(`/api/v1/admin/refresh-jobs/${encodeURIComponent(id)}/cancel`, {
        method: "POST",
        body: "{}",
      });
      applyCancelResultToJob(id, result);
      if (result.outcome === "failed_to_cancel") {
        error.value = result.message ?? "Failed to cancel job.";
      } else {
        message.value = result.message ?? "Job cancel succeeded.";
      }
    } else {
      const endpoint = action === "repairBootstrap" ? "rerun" : action;
      const result = await apiJson<{
        bootstrapRepaired?: boolean;
        enqueued?: boolean;
        resolveStatus?: string;
      }>(`/api/v1/admin/refresh-jobs/${encodeURIComponent(id)}/${endpoint}`, {
        method: "POST",
        body: "{}",
      });
      message.value =
        action === "repairBootstrap" || result.bootstrapRepaired
          ? result.enqueued
            ? "Bootstrap repaired — refresh queued."
            : "Bootstrap repaired."
          : `Job ${action} succeeded.`;
    }
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
      activeForceCancelled: number;
      alreadyCancellationRequested: number;
      alreadyTerminal: number;
      cancellationFailed: number;
      countBefore: number;
    }>("/api/v1/admin/refresh-jobs/kill-all", {
      method: "POST",
      body: JSON.stringify({ confirm: true }),
    });
    message.value = `Kill all (point-in-time): queued ${body.queuedCancelled}, delayed ${body.delayedCancelled}, active force-cancelled ${body.activeForceCancelled ?? 0}, active requested ${body.activeCancellationRequested}, already requested ${body.alreadyCancellationRequested}, already terminal ${body.alreadyTerminal}, failed ${body.cancellationFailed} (snapshot ${body.countBefore}). Bulk may still enqueue new refreshes unless paused.`;
    killConfirm.value = false;
    await loadJobs();
  } catch (err) {
    if (!handleAuthError(err)) error.value = (err as Error).message;
  } finally {
    actionBusyId.value = null;
  }
}

const totalPages = computed(() => Math.max(1, Math.ceil(jobsTotal.value / jobsPageSize.value)));
const bannerText = computed(() => error.value || message.value || "");
const bannerTone = computed(() => (error.value ? "error" : "success"));

watch(activeTab, (tab) => {
  error.value = null;
  message.value = null;
  if (tab === "characters") {
    void loadCharacterRealms();
  }
  if (tab === "refresh-jobs" && canManageJobs.value) {
    void loadJobs();
  }
});

watch(charRegion, () => {
  if (activeTab.value === "characters") {
    void loadCharacterRealms();
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

    <StatusBanner v-if="bannerText" :tone="bannerTone" :message="bannerText" />

    <div v-if="activeTab === 'accounts'" data-testid="panel-accounts">
      <p class="muted">
        Search by BattleTag or email. Authorization uses immutable user ID / Battle.net subject only.
      </p>
      <form class="search" @submit.prevent="searchUsers">
        <label>
          <span class="label">BattleTag or email</span>
          <input v-model="query" class="admin-control" type="search" name="q" autocomplete="off" placeholder="Name#1234" />
        </label>
        <button type="submit" class="btn" :disabled="busy">Search</button>
      </form>

      <label v-if="canManageUsers" class="admin-checkbox override">
        <input v-model="allowLastAdminRemoval" type="checkbox" />
        <span>Allow removing the last active admin (explicit override)</span>
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

    <div v-else-if="activeTab === 'characters'" data-testid="panel-characters">
      <form class="search search--grid search--characters" @submit.prevent="searchCharacters">
        <label class="search__region">
          <span class="label">Region</span>
          <select v-model="charRegion" class="admin-control">
            <option value="EU">EU</option>
            <option value="US">US</option>
            <option value="KR">KR</option>
            <option value="TW">TW</option>
          </select>
        </label>
        <label class="search__nickname">
          <span class="label">Nickname</span>
          <input v-model="charNickname" class="admin-control" type="search" autocomplete="off" placeholder="Character" />
        </label>
        <label class="search__realm">
          <span class="label">Realm / server</span>
          <select
            v-model="charRealm"
            class="admin-control"
            data-testid="admin-character-realm"
            :disabled="charRealmsLoading"
          >
            <option value="">Any realm</option>
            <option v-for="realm in charRealms" :key="realm.slug" :value="realm.slug">
              {{ realm.name }}
            </option>
          </select>
        </label>
        <button type="submit" class="btn" :disabled="busy">Search</button>
      </form>

      <ul class="results" data-testid="admin-characters-results">
        <li v-for="c in characters" :key="c.id" class="char-row">
          <CharacterIdentity
            compact
            :region="c.region"
            :name="c.name"
            :realm-slug="c.realmSlug"
            :class-slug="c.classSlug"
            :class-color="c.classColor"
            :avatar-url="c.avatarUrl"
            :class-icon-url="c.classIconUrl"
            :size="32"
          />
          <div class="char-row__meta">
            <span class="muted">
              M+ {{ c.mythicPlusScore != null ? Math.round(c.mythicPlusScore) : "—" }}
            </span>
            <StatusChip :status="c.refreshStatus" />
          </div>
        </li>
      </ul>
    </div>

    <div v-else data-testid="panel-refresh-jobs">
      <div v-if="!canManageJobs" class="muted">Requires admin.jobs.manage permission.</div>
      <template v-else>
        <div class="kill-all">
          <p class="muted">
            Cancels queued/delayed refresh-character jobs and force-cancels active ones (including
            zombies stuck after a prior cancel request) in this environment only. Does not touch
            ownership discovery, bulk orchestrator, or addon jobs.
          </p>
          <label class="admin-checkbox override">
            <input v-model="killConfirm" type="checkbox" />
            <span>I understand this is destructive</span>
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

        <form class="search search--grid" data-testid="refresh-jobs-filters" @submit.prevent="loadJobs">
          <label>
            <span class="label">Status</span>
            <select v-model="jobStatus" class="admin-control">
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
            <input v-model="jobRegion" class="admin-control" type="text" placeholder="EU" />
          </label>
          <label>
            <span class="label">Character</span>
            <input v-model="jobCharacter" class="admin-control" type="text" placeholder="name" />
          </label>
          <label>
            <span class="label">Trigger</span>
            <select v-model="jobTrigger" class="admin-control">
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
            <select v-model="jobFromBulk" class="admin-control">
              <option value="">Any</option>
              <option value="true">Bulk</option>
              <option value="false">Direct</option>
            </select>
          </label>
          <div class="historical-failures">
            <label class="admin-checkbox" data-testid="historical-failures-control">
              <input
                v-model="showHistoricalFailures"
                type="checkbox"
                data-testid="show-historical-failures"
              />
              <span>Include past failures</span>
            </label>
            <HelpTooltip :text="historicalFailuresHelp" label="About including past failures" />
          </div>
          <button type="submit" class="btn" :disabled="busy">Apply filters</button>
        </form>

        <ul class="results" data-testid="admin-refresh-jobs-results">
          <li v-for="job in jobs" :key="job.id" class="job-row" data-testid="job-row">
            <div class="job-main">
              <RouterLink
                v-if="job.region && job.realmSlug && job.name"
                class="job-row__character"
                data-testid="job-character-link"
                :to="characterRoute(job)!"
                :aria-label="`Open ${job.name} on ${job.realmSlug}`"
              >
                <CharacterIdentity
                  compact
                  :region="job.region"
                  :name="job.name"
                  :realm-slug="job.realmSlug"
                  :class-slug="job.classSlug"
                  :class-color="job.classColor"
                  :avatar-url="job.avatarUrl"
                  :class-icon-url="job.classIconUrl"
                  :size="32"
                />
              </RouterLink>
              <CharacterIdentity
                v-else
                compact
                :region="job.region"
                :name="job.name"
                :realm-slug="job.realmSlug"
                :class-slug="job.classSlug"
                :class-color="job.classColor"
                :avatar-url="job.avatarUrl"
                :class-icon-url="job.classIconUrl"
                :size="32"
              />
              <div class="job-meta">
                <StatusChip :status="job.databaseStatus" />
                <span v-if="job.cancelRequested" class="muted">cancel requested</span>
                <span class="muted mono" title="Job id">{{ job.id.slice(0, 8) }}…</span>
                <span class="muted">model {{ formatModelVersion(job) }}</span>
                <span class="muted">{{ job.fromBulk ? "bulk" : "direct" }} · prio {{ job.priority }}</span>
                <span v-if="job.triggerSource" class="muted">{{ job.triggerSource }}</span>
              </div>
              <div v-if="job.battleTag || job.battleNetEmail" class="job-account muted">
                <span v-if="job.battleTag">BattleTag {{ job.battleTag }}</span>
                <span v-if="job.battleNetEmail"> · {{ job.battleNetEmail }}</span>
              </div>
              <p class="job-times muted">
                created {{ formatTs(job.createdAt) }}
                <template v-if="job.startedAt"> · started {{ formatTs(job.startedAt) }}</template>
                <template v-if="job.finishedAt"> · finished {{ formatTs(job.finishedAt) }}</template>
              </p>
              <p v-if="job.latestError" class="error-line">
                {{ job.latestError.code ?? "ERROR" }}: {{ job.latestError.message }}
                <span v-if="job.retryable"> (retryable)</span>
              </p>
            </div>
            <div class="actions">
              <button
                v-if="job.actions.repairBootstrap"
                type="button"
                class="btn"
                data-testid="job-repair-bootstrap"
                :disabled="Boolean(actionBusyId)"
                @click="jobAction(job.id, 'repairBootstrap')"
              >
                Repair bootstrap
              </button>
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
  font-family: var(--font-data);
  font-size: 0.85em;
}
.label {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
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
.search > .btn {
  align-self: end;
  flex: 0 0 auto;
  min-height: 2.5rem;
  height: 2.5rem;
  box-sizing: border-box;
}
.search--characters {
  flex-wrap: nowrap;
}
.search--characters .search__region {
  flex: 0 0 4.75rem;
  min-width: 4.75rem;
  max-width: 4.75rem;
}
.search--characters .search__nickname {
  flex: 1 1 auto;
  min-width: 0;
}
.search--characters .search__realm {
  flex: 0 0 25%;
  min-width: 8rem;
  max-width: 25%;
}
@media (max-width: 640px) {
  .search--characters {
    flex-wrap: wrap;
  }
  .search--characters .search__region,
  .search--characters .search__nickname,
  .search--characters .search__realm {
    flex: 1 1 100%;
    max-width: none;
    min-width: 0;
  }
}
.override {
  margin-bottom: var(--space-4);
}
.historical-failures {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-width: 12rem;
  flex: 1;
  padding-bottom: 0.35rem;
}
.results {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.user-card,
.char-row,
.job-row {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
  flex-wrap: wrap;
  padding: var(--space-2) var(--space-3);
  border: 1px solid rgb(255 255 255 / 12%);
  border-radius: 0.45rem;
  align-items: center;
}
.char-row,
.job-row {
  justify-content: flex-start;
}
.char-row__meta {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  margin-left: auto;
  flex-wrap: wrap;
}
.job-main {
  flex: 1;
  min-width: 14rem;
  display: grid;
  gap: 0.25rem;
}
.job-row__character {
  display: inline-flex;
  width: fit-content;
  max-width: 100%;
  text-decoration: none;
  color: inherit;
  border-radius: 0.3rem;
}
.job-row__character:hover,
.job-row__character:focus-visible {
  outline: 2px solid rgb(245 158 11 / 45%);
  outline-offset: 2px;
}
.job-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem 0.65rem;
  font-size: 0.85rem;
}
.job-account,
.job-times {
  margin: 0;
  font-size: 0.8rem;
}
.actions {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  flex-wrap: wrap;
  margin-left: auto;
}
.btn {
  display: inline-flex;
  align-items: center;
  min-height: 2.25rem;
  padding: 0.4rem 0.85rem;
  border-radius: 0.4rem;
  border: none;
  background: #1f6feb;
  color: #fff;
  cursor: pointer;
  font: inherit;
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
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid rgb(185 28 28 / 45%);
  border-radius: 0.5rem;
  background: rgb(185 28 28 / 10%);
  margin-bottom: var(--space-4);
}
.kill-all .override {
  margin: 0;
}
.kill-all [data-testid="kill-all-refresh"] {
  margin-top: var(--space-2);
}
.error-line {
  margin: 0;
  color: #fca5a5;
  font-size: 0.85rem;
}
.pager {
  display: flex;
  gap: var(--space-3);
  align-items: center;
  margin-top: var(--space-4);
}
</style>
