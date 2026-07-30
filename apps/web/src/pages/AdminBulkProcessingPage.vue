<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ApiClientError } from "../api/live-client";
import StatusBanner from "../components/common/StatusBanner.vue";

const apiBase = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";
const router = useRouter();

interface BulkProgress {
  selectedCount: number;
  skippedCount: number;
  dispatchedCount: number;
  enqueuedCount: number;
  dispatchFailedCount: number;
  estimatedWclCalls: number | null;
  consumedWclCalls: number | null;
  cursor: number;
}

interface BulkOperationRow {
  id: string;
  mode: "FULL_REFRESH" | "RECALCULATE_ONLY";
  status: string;
  logicalKey: string;
  minMythicPlusScore: number | null;
  dryRun: boolean;
  completionSemantics?: "CHILD_DISPATCH_FINISHED";
  childOutcomesTracked?: boolean;
  progress: BulkProgress;
  createdAt: string;
}

const operations = ref<BulkOperationRow[]>([]);
const selectedId = ref<string | null>(null);
const detail = ref<(BulkOperationRow & { items?: unknown[] }) | null>(null);
const message = ref<string | null>(null);
const error = ref<string | null>(null);
const busy = ref(false);

const mode = ref<"FULL_REFRESH" | "RECALCULATE_ONLY">("RECALCULATE_ONLY");
const minScore = ref<string>("");
const batchSize = ref(25);
const maxCharacters = ref<string>("");
const maxWclCalls = ref<string>("");
const dryRun = ref(true);
const scoreModelId = ref("");

let pollTimer: ReturnType<typeof setInterval> | null = null;

function handleAuthError(err: unknown): boolean {
  if (err instanceof ApiClientError && (err.status === 401 || err.status === 403)) {
    void router.replace(err.status === 401 ? "/auth/signin" : "/access-denied");
    return true;
  }
  return false;
}

async function apiJson<T>(
  path: string,
  init?: { method?: string; body?: string },
): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    credentials: "include",
    method: init?.method,
    body: init?.body,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
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

async function loadOperations(): Promise<void> {
  const body = await apiJson<{ operations: BulkOperationRow[] }>("/api/v1/admin/bulk-operations");
  operations.value = body.operations;
}

async function loadDetail(id: string): Promise<void> {
  selectedId.value = id;
  detail.value = await apiJson(`/api/v1/admin/bulk-operations/${id}`);
}

async function createOperation(): Promise<void> {
  busy.value = true;
  error.value = null;
  message.value = null;
  try {
    const payload = {
      mode: mode.value,
      minMythicPlusScore: minScore.value.trim() === "" ? null : Number(minScore.value),
      scoreModelId: scoreModelId.value.trim() === "" ? null : scoreModelId.value.trim(),
      batchSize: batchSize.value,
      maxCharacters: maxCharacters.value.trim() === "" ? null : Number(maxCharacters.value),
      maxWclCalls: maxWclCalls.value.trim() === "" ? null : Number(maxWclCalls.value),
      dryRun: dryRun.value,
      allowFullRefreshOnIncompatible: false,
    };
    const created = await apiJson<BulkOperationRow>("/api/v1/admin/bulk-operations", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    message.value = dryRun.value
      ? `Dry-run completed: ${created.progress.selectedCount} characters selected.`
      : `Bulk operation ${created.id} created (${created.status}).`;
    await loadOperations();
    await loadDetail(created.id);
  } catch (err) {
    if (handleAuthError(err)) return;
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

async function pauseSelected(): Promise<void> {
  if (!selectedId.value) return;
  busy.value = true;
  try {
    await apiJson(`/api/v1/admin/bulk-operations/${selectedId.value}/pause`, { method: "POST" });
    message.value = "Pause requested.";
    await loadDetail(selectedId.value);
    await loadOperations();
  } catch (err) {
    if (handleAuthError(err)) return;
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

async function resumeSelected(): Promise<void> {
  if (!selectedId.value) return;
  busy.value = true;
  try {
    await apiJson(`/api/v1/admin/bulk-operations/${selectedId.value}/resume`, { method: "POST" });
    message.value = "Resume requested.";
    await loadDetail(selectedId.value);
    await loadOperations();
  } catch (err) {
    if (handleAuthError(err)) return;
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

async function cancelSelected(): Promise<void> {
  if (!selectedId.value) return;
  busy.value = true;
  try {
    await apiJson(`/api/v1/admin/bulk-operations/${selectedId.value}/cancel`, { method: "POST" });
    message.value = "Cancel requested.";
    await loadDetail(selectedId.value);
    await loadOperations();
  } catch (err) {
    if (handleAuthError(err)) return;
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

onMounted(async () => {
  try {
    await loadOperations();
  } catch (err) {
    if (handleAuthError(err)) return;
    error.value = err instanceof Error ? err.message : String(err);
  }
  pollTimer = setInterval(() => {
    void loadOperations().catch(() => undefined);
    if (selectedId.value) {
      void loadDetail(selectedId.value).catch(() => undefined);
    }
  }, 5000);
});

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
});
</script>

<template>
  <section class="admin-bulk" data-testid="admin-bulk-page">
    <header class="admin-bulk__header">
      <h1>Bulk character processing</h1>
      <p>
        Create, observe, pause, and cancel mass refresh or recalculate cohorts.
        Operation status <code>COMPLETED</code> means child-job dispatch finished — not that
        every character score has finished processing.
      </p>
    </header>

    <StatusBanner v-if="message" tone="success">{{ message }}</StatusBanner>
    <StatusBanner v-if="error" tone="error">{{ error }}</StatusBanner>

    <form class="admin-bulk__form" @submit.prevent="createOperation">
      <label>
        Mode
        <select v-model="mode" data-testid="bulk-mode">
          <option value="RECALCULATE_ONLY">RECALCULATE_ONLY</option>
          <option value="FULL_REFRESH">FULL_REFRESH</option>
        </select>
      </label>
      <label>
        Min Mythic+ score (empty = all)
        <input v-model="minScore" type="number" data-testid="bulk-min-score" />
      </label>
      <label>
        Score model id (optional)
        <input v-model="scoreModelId" type="text" data-testid="bulk-score-model-id" />
      </label>
      <label>
        Batch size
        <input v-model.number="batchSize" type="number" min="1" max="500" data-testid="bulk-batch-size" />
      </label>
      <label>
        Max characters (optional)
        <input v-model="maxCharacters" type="number" data-testid="bulk-max-characters" />
      </label>
      <label>
        Max WCL calls (FULL_REFRESH)
        <input v-model="maxWclCalls" type="number" data-testid="bulk-max-wcl" />
      </label>
      <label class="admin-bulk__checkbox">
        <input v-model="dryRun" type="checkbox" data-testid="bulk-dry-run" />
        Dry run (estimate only, no child jobs)
      </label>
      <button class="btn" type="submit" :disabled="busy" data-testid="bulk-create">
        {{ dryRun ? "Run dry-run estimate" : "Start bulk operation" }}
      </button>
    </form>

    <div class="admin-bulk__layout">
      <div>
        <h2>Recent operations</h2>
        <ul class="admin-bulk__list" data-testid="bulk-operations-list">
          <li v-for="op in operations" :key="op.id">
            <button type="button" class="admin-bulk__row" @click="loadDetail(op.id)">
              <strong>{{ op.mode }}</strong>
              <span>{{ op.status }}</span>
              <span>{{ op.progress.selectedCount }} selected</span>
              <span>{{ op.dryRun ? "dry-run" : "live" }}</span>
            </button>
          </li>
        </ul>
      </div>

      <div v-if="detail" class="admin-bulk__detail" data-testid="bulk-operation-detail">
        <h2>Operation detail</h2>
        <p class="admin-bulk__semantics" data-testid="bulk-completion-semantics">
          Completion means: {{ detail.completionSemantics ?? "CHILD_DISPATCH_FINISHED" }}
          (child outcomes tracked: {{ detail.childOutcomesTracked === true ? "yes" : "no" }})
        </p>
        <dl>
          <dt>Id</dt><dd>{{ detail.id }}</dd>
          <dt>Status</dt><dd data-testid="bulk-status">{{ detail.status }}</dd>
          <dt>Logical key</dt><dd>{{ detail.logicalKey }}</dd>
          <dt>Selected</dt><dd data-testid="bulk-selected">{{ detail.progress.selectedCount }}</dd>
          <dt>Dispatched</dt><dd data-testid="bulk-dispatched">{{ detail.progress.dispatchedCount }}</dd>
          <dt>Newly enqueued</dt><dd data-testid="bulk-enqueued">{{ detail.progress.enqueuedCount }}</dd>
          <dt>Dispatch failed</dt><dd data-testid="bulk-dispatch-failed">{{ detail.progress.dispatchFailedCount }}</dd>
          <dt>Skipped</dt><dd data-testid="bulk-skipped">{{ detail.progress.skippedCount }}</dd>
          <dt>Estimated WCL</dt><dd>{{ detail.progress.estimatedWclCalls ?? "—" }}</dd>
          <dt>Consumed WCL (est.)</dt><dd>{{ detail.progress.consumedWclCalls ?? "—" }}</dd>
        </dl>
        <div class="admin-bulk__actions">
          <button class="btn btn--ghost" type="button" :disabled="busy" data-testid="bulk-pause" @click="pauseSelected">
            Pause
          </button>
          <button class="btn btn--ghost" type="button" :disabled="busy" data-testid="bulk-resume" @click="resumeSelected">
            Resume
          </button>
          <button class="btn btn--ghost" type="button" :disabled="busy" data-testid="bulk-cancel" @click="cancelSelected">
            Cancel
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.admin-bulk {
  display: grid;
  gap: var(--space-5);
}
.admin-bulk__header h1 {
  margin: 0 0 var(--space-2);
}
.admin-bulk__form {
  display: grid;
  gap: var(--space-3);
  max-width: 32rem;
}
.admin-bulk__form label {
  display: grid;
  gap: var(--space-1);
}
.admin-bulk__checkbox {
  grid-template-columns: auto 1fr;
  align-items: center;
}
.admin-bulk__layout {
  display: grid;
  gap: var(--space-5);
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
}
.admin-bulk__list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: var(--space-2);
}
.admin-bulk__row {
  width: 100%;
  display: grid;
  gap: var(--space-1);
  text-align: left;
  padding: var(--space-3);
  border: 1px solid var(--color-border, #444);
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.admin-bulk__detail dl {
  display: grid;
  grid-template-columns: 10rem 1fr;
  gap: var(--space-2);
}
.admin-bulk__semantics {
  margin: 0 0 var(--space-3);
  font-size: 0.9rem;
  opacity: 0.85;
}
.admin-bulk__actions {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-3);
}
@media (max-width: 800px) {
  .admin-bulk__layout {
    grid-template-columns: 1fr;
  }
}
</style>
