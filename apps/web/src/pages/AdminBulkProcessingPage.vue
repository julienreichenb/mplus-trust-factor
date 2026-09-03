<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import type { AdminCharacterSearchHit, AdminScoreModelDTO, BulkMode } from "@mplus/contracts";
import { ApiClientError } from "../api/live-client";
import StatusBanner from "../components/common/StatusBanner.vue";
import HelpTooltip from "../components/common/HelpTooltip.vue";
import StatusChip from "../components/character/StatusChip.vue";
import CharacterIdentity from "../components/character/CharacterIdentity.vue";
import AdminCharacterPicker from "../components/admin/AdminCharacterPicker.vue";
import RelevantCharacterRefreshPanel from "../components/admin/RelevantCharacterRefreshPanel.vue";
import { parseOptionalNumber } from "../lib/parseOptionalNumber";

const DRY_RUN_TOOLTIP =
  "Dry run validates character selection, estimates WCL call cost, and persists the bulk operation plus selection rows, but does not enqueue child refresh or recalculate jobs. Turn Dry run off to dispatch child jobs that can update character scores and refresh data.";

const apiBase = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";
const router = useRouter();

type SelectionMode = "COHORT" | "EXPLICIT";

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

interface BulkOperationItem {
  id: string;
  characterId: string | null;
  position: number;
  status: string;
  region: string;
  realmSlug: string;
  characterName: string;
  mythicPlusScore: number | null;
  skipReason: string | null;
  errorMessage: string | null;
  childJobType: string | null;
}

interface BulkOperationRow {
  id: string;
  mode: BulkMode;
  status: string;
  selectionMode?: SelectionMode;
  logicalKey: string;
  minMythicPlusScore: number | null;
  dryRun: boolean;
  completionSemantics?: "CHILD_DISPATCH_FINISHED";
  childOutcomesTracked?: boolean;
  progress: BulkProgress;
  errorMessage?: string | null;
  createdAt: string;
}

interface BulkOperationDetail extends BulkOperationRow {
  items: BulkOperationItem[];
  itemsTotal?: number;
  itemsLimit?: number;
  itemsTruncated?: boolean;
}

const operations = ref<BulkOperationRow[]>([]);
const expandedId = ref<string | null>(null);
const detailById = ref<Record<string, BulkOperationDetail>>({});
const detailLoadingId = ref<string | null>(null);
const itemsExpanded = ref<Record<string, boolean>>({});
const message = ref<string | null>(null);
const error = ref<string | null>(null);
const fieldErrors = ref<Record<string, string>>({});
const busy = ref(false);

type BulkTab = "bulk" | "relevant-refresh";
const activeTab = ref<BulkTab>("bulk");

const mode = ref<BulkMode>("RECALCULATE_ONLY");
const selectionMode = ref<SelectionMode>("COHORT");
const minScore = ref<string | number>("");
const batchSize = ref(25);
const maxCharacters = ref<string | number>("");
const maxWclCalls = ref<string | number>("");
const dryRun = ref(true);
const scoreModelId = ref<string>("");
const selectedCharacters = ref<AdminCharacterSearchHit[]>([]);
const models = ref<AdminScoreModelDTO[]>([]);

const showWclBudget = computed(() => mode.value === "FULL_REFRESH");
const canPause = (status: string) => ["PENDING", "SELECTING", "RUNNING"].includes(status);
const canResume = (status: string) => status === "PAUSED";
const canCancel = (status: string) =>
  !["COMPLETED", "CANCELLED", "FAILED", "DRY_RUN_COMPLETED"].includes(status);

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

async function loadModels(): Promise<void> {
  try {
    const body = await apiJson<{ models: AdminScoreModelDTO[] }>("/api/v1/admin/score-models");
    models.value = body.models;
  } catch {
    models.value = [];
  }
}

async function loadDetail(id: string): Promise<void> {
  detailLoadingId.value = id;
  try {
    detailById.value = {
      ...detailById.value,
      [id]: await apiJson<BulkOperationDetail>(`/api/v1/admin/bulk-operations/${id}`),
    };
  } finally {
    if (detailLoadingId.value === id) detailLoadingId.value = null;
  }
}

async function toggleOperation(id: string): Promise<void> {
  if (expandedId.value === id) {
    expandedId.value = null;
    return;
  }
  expandedId.value = id;
  if (!detailById.value[id]) {
    await loadDetail(id);
  }
}

function toggleItems(id: string): void {
  itemsExpanded.value = { ...itemsExpanded.value, [id]: !itemsExpanded.value[id] };
}

function validateForm(): Record<string, unknown> | null {
  fieldErrors.value = {};
  const errors: Record<string, string> = {};

  if (!Number.isInteger(batchSize.value) || batchSize.value < 1 || batchSize.value > 500) {
    errors.batchSize = "Batch size must be an integer between 1 and 500";
  }

  let minMythicPlusScore: number | null = null;
  let maxCharactersValue: number | null = null;
  let maxWclCallsValue: number | null = null;
  let characterIds: string[] | null = null;

  if (selectionMode.value === "COHORT") {
    const minParsed = parseOptionalNumber(minScore.value, "Minimum Mythic+ score");
    if (!minParsed.ok) errors.minScore = minParsed.error;
    else minMythicPlusScore = minParsed.value;

    const maxParsed = parseOptionalNumber(maxCharacters.value, "Max characters");
    if (!maxParsed.ok) errors.maxCharacters = maxParsed.error;
    else if (maxParsed.value != null && (!Number.isInteger(maxParsed.value) || maxParsed.value < 1)) {
      errors.maxCharacters = "Max characters must be a positive integer";
    } else {
      maxCharactersValue = maxParsed.value;
    }
  } else {
    if (selectedCharacters.value.length === 0) {
      errors.characters = "Select at least one character";
    } else if (selectedCharacters.value.length > 500) {
      errors.characters = "Maximum 500 characters";
    } else {
      characterIds = selectedCharacters.value.map((c) => c.characterId);
    }
    minMythicPlusScore = null;
    maxCharactersValue = null;
  }

  if (showWclBudget.value) {
    const wclParsed = parseOptionalNumber(maxWclCalls.value, "Max WCL calls");
    if (!wclParsed.ok) errors.maxWclCalls = wclParsed.error;
    else if (wclParsed.value != null && (!Number.isInteger(wclParsed.value) || wclParsed.value < 1)) {
      errors.maxWclCalls = "Max WCL calls must be a positive integer";
    } else {
      maxWclCallsValue = wclParsed.value;
    }
  }

  if (Object.keys(errors).length > 0) {
    fieldErrors.value = errors;
    return null;
  }

  return {
    mode: mode.value,
    minMythicPlusScore,
    scoreModelId: scoreModelId.value === "" ? null : scoreModelId.value,
    batchSize: batchSize.value,
    maxCharacters: maxCharactersValue,
    maxWclCalls: showWclBudget.value ? maxWclCallsValue : null,
    dryRun: dryRun.value,
    allowFullRefreshOnIncompatible: false,
    characterIds,
  };
}

async function createOperation(): Promise<void> {
  const payload = validateForm();
  if (!payload) {
    error.value = "Fix validation errors before submitting.";
    return;
  }
  busy.value = true;
  error.value = null;
  message.value = null;
  try {
    const created = await apiJson<BulkOperationRow>("/api/v1/admin/bulk-operations", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    message.value = dryRun.value
      ? `Dry-run completed: ${created.progress.selectedCount} characters selected.`
      : `Bulk operation ${created.id} created (${created.status}).`;
    await loadOperations();
    // Keep cards collapsed by default after create.
    expandedId.value = null;
  } catch (err) {
    if (handleAuthError(err)) return;
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

async function pauseOperation(id: string): Promise<void> {
  busy.value = true;
  try {
    await apiJson(`/api/v1/admin/bulk-operations/${id}/pause`, { method: "POST" });
    message.value = "Pause requested.";
    await loadDetail(id);
    await loadOperations();
  } catch (err) {
    if (handleAuthError(err)) return;
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

async function resumeOperation(id: string): Promise<void> {
  busy.value = true;
  try {
    await apiJson(`/api/v1/admin/bulk-operations/${id}/resume`, { method: "POST" });
    message.value = "Resume requested.";
    await loadDetail(id);
    await loadOperations();
  } catch (err) {
    if (handleAuthError(err)) return;
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

async function cancelOperation(id: string): Promise<void> {
  busy.value = true;
  try {
    await apiJson(`/api/v1/admin/bulk-operations/${id}/cancel`, { method: "POST" });
    message.value = "Cancel requested.";
    await loadDetail(id);
    await loadOperations();
  } catch (err) {
    if (handleAuthError(err)) return;
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function modelLabel(model: AdminScoreModelDTO): string {
  return `${model.key} · v${model.version} · ${model.status}${model.name ? ` · ${model.name}` : ""}`;
}

onMounted(async () => {
  try {
    await Promise.all([loadOperations(), loadModels()]);
  } catch (err) {
    if (handleAuthError(err)) return;
    error.value = err instanceof Error ? err.message : String(err);
  }
  pollTimer = setInterval(() => {
    void loadOperations().catch(() => undefined);
    if (expandedId.value) {
      void loadDetail(expandedId.value).catch(() => undefined);
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
      <p class="eyebrow">Admin</p>
      <h1 class="mpts-display">Bulk character processing</h1>
      <p class="admin-bulk__lede">
        Create, observe, pause, and cancel mass refresh or recalculate cohorts.
        Status <code>COMPLETED</code> means child-job dispatch finished — not that every character
        score finished processing.
      </p>
    </header>

    <nav class="tabs" aria-label="Admin sections">
      <button
        type="button"
        class="tab"
        :class="{ 'tab--active': activeTab === 'bulk' }"
        data-testid="tab-bulk-processing"
        @click="activeTab = 'bulk'"
      >
        Bulk processing
      </button>
      <button
        type="button"
        class="tab"
        :class="{ 'tab--active': activeTab === 'relevant-refresh' }"
        data-testid="tab-relevant-character-refresh"
        @click="activeTab = 'relevant-refresh'"
      >
        Relevant character refresh
      </button>
    </nav>

    <StatusBanner v-if="activeTab === 'bulk' && message" tone="success">{{ message }}</StatusBanner>
    <StatusBanner v-if="activeTab === 'bulk' && error" tone="error">{{ error }}</StatusBanner>

    <RelevantCharacterRefreshPanel v-if="activeTab === 'relevant-refresh'" />

    <form
      v-if="activeTab === 'bulk'"
      class="admin-bulk__form"
      data-testid="bulk-create-form"
      @submit.prevent="createOperation"
    >
      <div class="admin-bulk__grid">
        <section class="admin-card" data-testid="bulk-section-mode">
          <h2>Operation type</h2>
          <p class="admin-card__help">Choose whether to refresh provider evidence or recalculate scores only.</p>
          <div class="segmented" role="group" aria-label="Operation mode">
            <button
              type="button"
              class="segmented__btn"
              :class="{ 'is-active': mode === 'FULL_REFRESH' }"
              data-testid="bulk-mode-full"
              :aria-pressed="mode === 'FULL_REFRESH'"
              @click="mode = 'FULL_REFRESH'"
            >
              Full refresh
            </button>
            <button
              type="button"
              class="segmented__btn"
              :class="{ 'is-active': mode === 'RECALCULATE_ONLY' }"
              data-testid="bulk-mode-recalc"
              :aria-pressed="mode === 'RECALCULATE_ONLY'"
              @click="mode = 'RECALCULATE_ONLY'"
            >
              Recalculate only
            </button>
          </div>
          <input v-model="mode" type="hidden" data-testid="bulk-mode" />

          <label class="admin-field">
            <span>Score model</span>
            <select v-model="scoreModelId" class="admin-control" data-testid="bulk-score-model">
              <option value="">Active model</option>
              <option v-for="model in models" :key="model.id" :value="model.id">
                {{ modelLabel(model) }}
              </option>
            </select>
            <span class="admin-field__help">Leave as Active model unless targeting a specific version.</span>
          </label>
        </section>

        <section class="admin-card" data-testid="bulk-section-selection">
          <h2>Character selection</h2>
          <div class="segmented" role="group" aria-label="Selection mode">
            <button
              type="button"
              class="segmented__btn"
              :class="{ 'is-active': selectionMode === 'COHORT' }"
              data-testid="bulk-selection-cohort"
              :aria-pressed="selectionMode === 'COHORT'"
              @click="selectionMode = 'COHORT'"
            >
              Cohort
            </button>
            <button
              type="button"
              class="segmented__btn"
              :class="{ 'is-active': selectionMode === 'EXPLICIT' }"
              data-testid="bulk-selection-explicit"
              :aria-pressed="selectionMode === 'EXPLICIT'"
              @click="selectionMode = 'EXPLICIT'"
            >
              Specific characters
            </button>
          </div>

          <div v-if="selectionMode === 'COHORT'" class="admin-card__stack" data-testid="bulk-cohort-controls">
            <label class="admin-field">
              <span>Minimum Mythic+ score</span>
              <input
                v-model="minScore"
                class="admin-control"
                type="text"
                inputmode="decimal"
                data-testid="bulk-min-score"
              />
              <span class="admin-field__help">Leave empty to include all persisted characters.</span>
              <span v-if="fieldErrors.minScore" class="admin-field__error" role="alert">{{ fieldErrors.minScore }}</span>
            </label>
            <label class="admin-field">
              <span>Max characters</span>
              <input
                v-model="maxCharacters"
                class="admin-control"
                type="text"
                inputmode="numeric"
                data-testid="bulk-max-characters"
              />
              <span class="admin-field__help">Optional cap after deterministic score ordering.</span>
              <span v-if="fieldErrors.maxCharacters" class="admin-field__error" role="alert">{{ fieldErrors.maxCharacters }}</span>
            </label>
          </div>

          <div v-else class="admin-card__stack" data-testid="bulk-explicit-controls">
            <AdminCharacterPicker v-model="selectedCharacters" :disabled="busy" />
            <span v-if="fieldErrors.characters" class="admin-field__error" role="alert">{{ fieldErrors.characters }}</span>
          </div>
        </section>

        <section class="admin-card" data-testid="bulk-section-limits">
          <h2>Execution limits</h2>
          <label class="admin-field">
            <span>Batch size</span>
            <input
              v-model.number="batchSize"
              class="admin-control"
              type="number"
              min="1"
              max="500"
              step="1"
              required
              data-testid="bulk-batch-size"
            />
            <span class="admin-field__help">Child jobs enqueued per orchestrator tick (1–500).</span>
            <span v-if="fieldErrors.batchSize" class="admin-field__error" role="alert">{{ fieldErrors.batchSize }}</span>
          </label>
          <label v-if="showWclBudget" class="admin-field" data-testid="bulk-wcl-field">
            <span>Max WCL calls</span>
            <input
              v-model="maxWclCalls"
              class="admin-control"
              type="text"
              inputmode="numeric"
              data-testid="bulk-max-wcl"
            />
            <span class="admin-field__help">Optional budget stop for full-refresh dispatches.</span>
            <span v-if="fieldErrors.maxWclCalls" class="admin-field__error" role="alert">{{ fieldErrors.maxWclCalls }}</span>
          </label>
        </section>

        <section class="admin-card" data-testid="bulk-section-execute">
          <h2>
            Dry-run / execution
            <HelpTooltip :text="DRY_RUN_TOOLTIP" label="About dry run" />
          </h2>
          <label class="switch" data-testid="bulk-dry-run-switch">
            <input v-model="dryRun" type="checkbox" data-testid="bulk-dry-run" />
            <span class="switch__track" aria-hidden="true" />
            <span class="switch__copy">
              <strong>{{ dryRun ? "Dry run" : "Live run" }}</strong>
              <span>
                {{
                  dryRun
                    ? "Estimate selection and WCL cost without enqueueing child jobs."
                    : "Dispatch child jobs according to mode and budgets."
                }}
              </span>
            </span>
          </label>
          <div class="admin-card__actions">
            <button class="btn primary" type="submit" :disabled="busy" data-testid="bulk-create">
              {{ dryRun ? "Run dry-run estimate" : "Start bulk operation" }}
            </button>
          </div>
        </section>
      </div>
    </form>

    <section
      v-if="activeTab === 'bulk'"
      class="admin-card admin-bulk__recent"
      data-testid="bulk-section-recent"
    >
      <h2>Recent operations</h2>
      <ul class="admin-bulk__list" data-testid="bulk-operations-list">
        <li v-for="op in operations" :key="op.id" class="op-card">
          <button
            type="button"
            class="op-card__summary"
            :aria-expanded="expandedId === op.id"
            :aria-controls="`bulk-op-panel-${op.id}`"
            data-testid="bulk-op-summary"
            @click="toggleOperation(op.id)"
          >
            <span class="op-card__chevron" :class="{ 'is-open': expandedId === op.id }" aria-hidden="true">▸</span>
            <span class="op-card__title">
              <strong>{{ op.mode === "FULL_REFRESH" ? "Full refresh" : "Recalculate only" }}</strong>
              <span class="chip">{{ op.selectionMode === "EXPLICIT" ? "Explicit" : "Cohort" }}</span>
              <StatusChip :status="op.status" data-testid="bulk-status-chip" />
              <span class="chip" :class="op.dryRun ? 'chip--dry' : 'chip--live'">
                {{ op.dryRun ? "Dry-run" : "Live" }}
              </span>
            </span>
            <span class="op-card__meta mpts-data">
              {{ op.progress.selectedCount }} selected · {{ op.progress.dispatchedCount }} dispatched ·
              {{ formatDate(op.createdAt) }}
            </span>
          </button>

          <div
            v-if="expandedId === op.id"
            :id="`bulk-op-panel-${op.id}`"
            class="op-card__detail"
            data-testid="bulk-operation-detail"
          >
            <p v-if="detailLoadingId === op.id" class="admin-field__help">Loading detail…</p>
            <template v-else-if="detailById[op.id]">
              <p class="admin-bulk__semantics" data-testid="bulk-completion-semantics">
                Completion means:
                {{ detailById[op.id]!.completionSemantics ?? "CHILD_DISPATCH_FINISHED" }}
                (child outcomes tracked:
                {{ detailById[op.id]!.childOutcomesTracked === true ? "yes" : "no" }})
              </p>
              <dl class="op-card__stats">
                <div><dt>Selected</dt><dd data-testid="bulk-selected">{{ detailById[op.id]!.progress.selectedCount }}</dd></div>
                <div><dt>Dispatched</dt><dd data-testid="bulk-dispatched">{{ detailById[op.id]!.progress.dispatchedCount }}</dd></div>
                <div><dt>Newly enqueued</dt><dd data-testid="bulk-enqueued">{{ detailById[op.id]!.progress.enqueuedCount }}</dd></div>
                <div><dt>Dispatch failed</dt><dd data-testid="bulk-dispatch-failed">{{ detailById[op.id]!.progress.dispatchFailedCount }}</dd></div>
                <div><dt>Skipped</dt><dd data-testid="bulk-skipped">{{ detailById[op.id]!.progress.skippedCount }}</dd></div>
                <div><dt>Estimated WCL</dt><dd>{{ detailById[op.id]!.progress.estimatedWclCalls ?? "—" }}</dd></div>
                <div><dt>Consumed WCL (est.)</dt><dd>{{ detailById[op.id]!.progress.consumedWclCalls ?? "—" }}</dd></div>
              </dl>
              <p v-if="detailById[op.id]!.errorMessage" class="admin-field__error" role="alert">
                {{ detailById[op.id]!.errorMessage }}
              </p>
              <div class="admin-bulk__actions">
                <button
                  v-if="canPause(detailById[op.id]!.status)"
                  class="btn secondary"
                  type="button"
                  :disabled="busy"
                  data-testid="bulk-pause"
                  @click="pauseOperation(op.id)"
                >
                  Pause
                </button>
                <button
                  v-if="canResume(detailById[op.id]!.status)"
                  class="btn secondary"
                  type="button"
                  :disabled="busy"
                  data-testid="bulk-resume"
                  @click="resumeOperation(op.id)"
                >
                  Resume
                </button>
                <button
                  v-if="canCancel(detailById[op.id]!.status)"
                  class="btn secondary"
                  type="button"
                  :disabled="busy"
                  data-testid="bulk-cancel"
                  @click="cancelOperation(op.id)"
                >
                  Cancel
                </button>
              </div>

              <div class="op-items">
                <button
                  type="button"
                  class="op-items__toggle"
                  :aria-expanded="!!itemsExpanded[op.id]"
                  :aria-controls="`bulk-items-${op.id}`"
                  data-testid="bulk-items-toggle"
                  @click="toggleItems(op.id)"
                >
                  <span class="op-card__chevron" :class="{ 'is-open': itemsExpanded[op.id] }" aria-hidden="true">▸</span>
                  Characters ({{ detailById[op.id]!.itemsTotal ?? detailById[op.id]!.items.length }})
                </button>
                <div v-if="itemsExpanded[op.id]" :id="`bulk-items-${op.id}`">
                  <p
                    v-if="detailById[op.id]!.itemsTruncated"
                    class="admin-field__help"
                    data-testid="bulk-items-truncated"
                  >
                    Showing {{ detailById[op.id]!.items.length }} of
                    {{ detailById[op.id]!.itemsTotal }} characters (API limit
                    {{ detailById[op.id]!.itemsLimit }}).
                  </p>
                  <ul class="op-items__list" data-testid="bulk-items-list">
                    <li v-for="item in detailById[op.id]!.items" :key="item.id" class="op-items__row">
                      <CharacterIdentity
                        compact
                        :region="item.region"
                        :name="item.characterName"
                        :realm-slug="item.realmSlug"
                        :size="28"
                      />
                      <StatusChip :status="item.status" data-testid="bulk-item-status" />
                      <span v-if="item.childJobType" class="op-items__muted">{{ item.childJobType }}</span>
                      <span v-if="item.skipReason" class="op-items__muted">{{ item.skipReason }}</span>
                      <span v-if="item.errorMessage" class="admin-field__error">{{ item.errorMessage }}</span>
                    </li>
                  </ul>
                </div>
              </div>
            </template>
          </div>
        </li>
      </ul>
      <p v-if="operations.length === 0" class="admin-field__help">No bulk operations yet.</p>
    </section>
  </section>
</template>

<style scoped>
.admin-bulk {
  display: grid;
  gap: var(--space-6);
  max-width: var(--container-page);
}
.admin-bulk__header h1 {
  margin: var(--space-2) 0;
  font-size: var(--text-3xl);
}
.admin-bulk__lede {
  margin: 0;
  max-width: 48rem;
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
.admin-bulk__grid {
  display: grid;
  gap: var(--space-4);
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.admin-card {
  display: grid;
  gap: var(--space-3);
  align-content: start;
  padding: var(--space-5);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  background: linear-gradient(180deg, var(--color-bg-elevated), var(--color-surface));
}
.admin-card h2 {
  margin: 0;
  font-size: var(--text-lg);
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}
.admin-card__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
}
.admin-card__actions .btn,
.admin-card > .btn,
.admin-card .btn.primary,
.admin-card .btn.secondary {
  align-self: start;
  flex: 0 0 auto;
  height: 2.75rem;
  min-height: 2.75rem;
  max-height: 2.75rem;
}
.admin-card__help,
.admin-field__help {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}
.admin-card__stack {
  display: grid;
  gap: var(--space-3);
}
.admin-field {
  display: grid;
  gap: var(--space-1);
}
.admin-field__error {
  color: var(--color-danger-500);
  font-size: var(--text-sm);
}
.admin-control {
  width: 100%;
  min-height: 2.5rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  background: var(--color-bg);
  color: var(--color-text);
  font: inherit;
}
.admin-control:hover:not(:disabled) {
  background: var(--color-surface-hover);
}
.admin-control:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus);
}
.admin-control:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.segmented {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-1);
  padding: var(--space-1);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  background: var(--color-bg);
}
.segmented__btn {
  min-height: 2.4rem;
  border: 0;
  border-radius: calc(var(--radius-control) - 2px);
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  font: inherit;
}
.segmented__btn.is-active {
  background: var(--color-surface-hover);
  color: var(--color-text);
  box-shadow: inset 0 0 0 1px var(--color-border);
}
.segmented__btn:hover:not(.is-active) {
  color: var(--color-text);
}
.switch {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--space-3);
  align-items: start;
  cursor: pointer;
}
.switch input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}
.switch__track {
  width: 2.75rem;
  height: 1.5rem;
  margin-top: 0.15rem;
  border-radius: var(--radius-pill);
  background: var(--color-iron-700);
  position: relative;
  transition: background var(--duration-fast);
}
.switch__track::after {
  content: "";
  position: absolute;
  top: 0.15rem;
  left: 0.15rem;
  width: 1.2rem;
  height: 1.2rem;
  border-radius: 50%;
  background: var(--color-stone-100);
  transition: transform var(--duration-fast);
}
.switch input:checked + .switch__track {
  background: var(--color-brand);
}
.switch input:checked + .switch__track::after {
  transform: translateX(1.2rem);
}
.switch input:focus-visible + .switch__track {
  box-shadow: var(--shadow-focus);
}
.switch__copy {
  display: grid;
  gap: var(--space-1);
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}
.switch__copy strong {
  color: var(--color-text);
}
.admin-bulk__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-3);
}
.op-card {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  background: var(--color-bg-elevated);
  overflow: hidden;
}
.op-card__summary {
  width: 100%;
  display: grid;
  gap: var(--space-2);
  grid-template-columns: auto 1fr;
  text-align: left;
  padding: var(--space-4);
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.op-card__summary:hover {
  background: var(--color-surface-hover);
}
.op-card__chevron {
  display: inline-block;
  transition: transform var(--duration-fast);
  color: var(--color-text-muted);
}
.op-card__chevron.is-open {
  transform: rotate(90deg);
}
.op-card__title {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
}
.op-card__meta {
  grid-column: 2;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}
.op-card__detail {
  padding: 0 var(--space-4) var(--space-4);
  display: grid;
  gap: var(--space-3);
  border-top: 1px solid var(--color-border);
}
.op-card__stats {
  display: grid;
  gap: var(--space-2);
  grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
  margin: 0;
}
.op-card__stats div {
  display: grid;
  gap: var(--space-1);
}
.op-card__stats dt {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}
.op-card__stats dd {
  margin: 0;
  font-family: var(--font-data);
}
.admin-bulk__semantics {
  margin: var(--space-3) 0 0;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}
.admin-bulk__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.chip {
  display: inline-flex;
  align-items: center;
  padding: 0.15rem 0.5rem;
  border-radius: var(--radius-control);
  border: 1px solid var(--color-border);
  font-size: var(--text-xs);
  font-family: var(--font-data);
  color: var(--color-text-muted);
}
.chip--dry {
  color: var(--color-info-500);
}
.chip--live {
  color: var(--color-amber-400);
}
.chip--enqueued {
  color: var(--color-success-500);
}
.chip--skipped {
  color: var(--color-text-muted);
}
.admin-badge {
  display: inline-flex;
  padding: 0.1rem 0.4rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  font-size: var(--text-xs);
  font-family: var(--font-data);
  color: var(--color-text-muted);
}
.op-items__toggle {
  display: inline-flex;
  gap: var(--space-2);
  align-items: center;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
  padding: 0;
}
.op-items__list {
  list-style: none;
  margin: var(--space-2) 0 0;
  padding: 0;
  display: grid;
  gap: var(--space-2);
  max-height: calc(6 * 2.6rem);
  overflow-y: auto;
}
.op-items__row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
  padding: var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  font-size: var(--text-sm);
}
.op-items__name {
  font-weight: 600;
}
.op-items__muted {
  color: var(--color-text-muted);
}
@media (max-width: 900px) {
  .admin-bulk__grid {
    grid-template-columns: 1fr;
  }
}
</style>
