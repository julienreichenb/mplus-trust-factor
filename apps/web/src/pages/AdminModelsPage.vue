<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { api } from "../api/client";
import type {
  ActivateScoreModelResult,
  AdminScoreModelDTO,
  ScoreModelDependencyCounts,
} from "../api/types";
import { ApiClientError } from "../api/live-client";
import StatusBanner from "../components/common/StatusBanner.vue";
import SkeletonBlock from "../components/common/SkeletonBlock.vue";
import ModelStatusBadge from "../components/admin/ModelStatusBadge.vue";

const router = useRouter();
const models = ref<AdminScoreModelDTO[]>([]);
const loading = ref(true);
const loadError = ref<string | null>(null);
const message = ref<string | null>(null);
const error = ref<string | null>(null);
const busy = ref(false);

const showActivateConfirm = ref(false);
const activateTarget = ref<AdminScoreModelDTO | null>(null);
const activating = ref(false);
const activationResult = ref<ActivateScoreModelResult | null>(null);

const deleteTarget = ref<AdminScoreModelDTO | null>(null);
const showDeleteConfirm = ref(false);
const deleting = ref(false);
const deleteError = ref<string | null>(null);
const deleteConflictCounts = ref<ScoreModelDependencyCounts | null>(null);

type StatusFilter = "ALL" | "ACTIVE" | "DRAFT" | "ARCHIVED";
const catalogQuery = ref("");
const catalogStatus = ref<StatusFilter>("ALL");

const STATUS_RANK: Record<AdminScoreModelDTO["status"], number> = {
  ACTIVE: 0,
  DRAFT: 1,
  ARCHIVED: 2,
};

const activeModel = computed(() => models.value.find((m) => m.status === "ACTIVE") ?? null);

const filteredModels = computed(() => {
  const q = catalogQuery.value.trim().toLowerCase();
  return models.value.filter((m) => {
    if (catalogStatus.value !== "ALL" && m.status !== catalogStatus.value) return false;
    if (!q) return true;
    return (
      m.name.toLowerCase().includes(q) ||
      `v${m.version}`.toLowerCase().includes(q) ||
      String(m.version).includes(q)
    );
  });
});

const sortedModels = computed(() =>
  [...filteredModels.value].sort((a, b) => {
    const rankDiff = STATUS_RANK[a.status] - STATUS_RANK[b.status];
    if (rankDiff !== 0) return rankDiff;
    return b.createdAt.localeCompare(a.createdAt) || b.version - a.version;
  }),
);

const isEmptyCatalog = computed(
  () => !loading.value && !loadError.value && models.value.length === 0,
);
const hasActiveFilters = computed(
  () => catalogQuery.value.trim().length > 0 || catalogStatus.value !== "ALL",
);

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  try {
    models.value = await api.listModels();
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

async function duplicateAsDraft(model: AdminScoreModelDTO): Promise<void> {
  busy.value = true;
  error.value = null;
  message.value = null;
  try {
    const draft = await api.cloneModel(model.id);
    models.value = await api.listModels();
    message.value = `Created draft “${draft.name}” (v${draft.version}).`;
    await router.push({ name: "admin-tuning", query: { model: draft.id } });
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

function openTune(model: AdminScoreModelDTO): void {
  void router.push({ name: "admin-tuning", query: { model: model.id } });
}

function openView(model: AdminScoreModelDTO): void {
  void router.push({ name: "admin-tuning", query: { model: model.id } });
}

function requestActivate(model: AdminScoreModelDTO): void {
  activateTarget.value = model;
  activationResult.value = null;
  showActivateConfirm.value = true;
}

async function confirmActivate(): Promise<void> {
  if (!activateTarget.value) return;
  activating.value = true;
  error.value = null;
  message.value = null;
  try {
    activationResult.value = await api.activateModel(activateTarget.value.id, {
      confirm: true,
      expectedPreviousActiveId: activeModel.value?.id ?? null,
    });
    models.value = await api.listModels();
    message.value = `Activated “${activateTarget.value.name}” v${activateTarget.value.version}. Previous production model was archived.`;
    showActivateConfirm.value = false;
    activateTarget.value = null;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    activating.value = false;
  }
}

function requestDelete(model: AdminScoreModelDTO): void {
  deleteTarget.value = model;
  deleteError.value = null;
  deleteConflictCounts.value = null;
  showDeleteConfirm.value = true;
}

async function confirmDelete(): Promise<void> {
  if (!deleteTarget.value) return;
  deleting.value = true;
  deleteError.value = null;
  try {
    await api.deleteModel(deleteTarget.value.id);
    models.value = await api.listModels();
    message.value = `Deleted draft “${deleteTarget.value.name}”.`;
    showDeleteConfirm.value = false;
    deleteTarget.value = null;
  } catch (err) {
    if (err instanceof ApiClientError && err.code === "SCORE_MODEL_DRAFT_IN_USE") {
      deleteConflictCounts.value =
        (err.details as { dependencyCounts?: ScoreModelDependencyCounts } | undefined)
          ?.dependencyCounts ?? null;
      deleteError.value = "This draft is referenced by existing scores and cannot be deleted.";
    } else {
      deleteError.value = err instanceof Error ? err.message : String(err);
    }
  } finally {
    deleting.value = false;
  }
}

onMounted(() => {
  void load();
});
</script>

<template>
  <main class="admin-page" aria-labelledby="models-title" data-testid="admin-models-page">
    <header class="admin-page__header">
      <div>
        <p class="eyebrow">Scoring</p>
        <h1 id="models-title">Models</h1>
        <p class="lede">
          Global scoring models. Exactly one model is production-active. Tune drafts, then activate
          with confirmation — activation archives the previous production model.
        </p>
      </div>
      <div class="header-actions">
        <RouterLink class="btn ghost" :to="{ name: 'admin-tuning' }">Open Tuning</RouterLink>
        <RouterLink class="btn ghost" :to="{ name: 'admin-calibration' }">Calibration</RouterLink>
      </div>
    </header>

    <StatusBanner v-if="message" tone="success" data-testid="models-success">{{ message }}</StatusBanner>
    <StatusBanner v-if="error" tone="error" data-testid="models-error">{{ error }}</StatusBanner>
    <StatusBanner v-if="loadError" tone="error" data-testid="models-load-error">{{ loadError }}</StatusBanner>

    <section class="panel" aria-label="Model catalog">
      <div class="toolbar">
        <label class="search">
          <span class="sr-only">Search models</span>
          <input
            v-model="catalogQuery"
            type="search"
            placeholder="Search by name or version…"
            data-testid="models-search"
          />
        </label>
        <label class="filter">
          <span class="sr-only">Filter by status</span>
          <select v-model="catalogStatus" data-testid="models-status-filter">
            <option value="ALL">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="DRAFT">Draft</option>
            <option value="ARCHIVED">Archived</option>
          </select>
        </label>
        <button
          v-if="hasActiveFilters"
          type="button"
          class="btn ghost"
          data-testid="models-clear-filters"
          @click="catalogQuery = ''; catalogStatus = 'ALL'"
        >
          Clear filters
        </button>
      </div>

      <div v-if="loading" class="skeletons" data-testid="models-loading">
        <SkeletonBlock height="3rem" />
        <SkeletonBlock height="3rem" />
        <SkeletonBlock height="3rem" />
      </div>

      <div v-else-if="isEmptyCatalog" class="empty" data-testid="models-empty">
        <h2>No scoring models yet</h2>
        <p>Seed the database or create a draft from an existing environment backup.</p>
      </div>

      <div v-else-if="sortedModels.length === 0" class="empty" data-testid="models-filter-empty">
        <h2>No models match</h2>
        <p>Try clearing filters or searching by version number.</p>
      </div>

      <div v-else class="table-wrap">
        <table class="models-table" data-testid="models-table">
          <thead>
            <tr>
              <th scope="col">Model</th>
              <th scope="col">Status</th>
              <th scope="col">Created</th>
              <th scope="col">Activated</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="model in sortedModels"
              :key="model.id"
              :data-testid="`model-row-${model.status.toLowerCase()}`"
              :data-model-version="model.version"
            >
              <td>
                <div class="model-name">{{ model.name }}</div>
                <div class="model-meta">Version {{ model.version }}</div>
              </td>
              <td>
                <ModelStatusBadge
                  :status="model.status"
                  :production="model.status === 'ACTIVE'"
                />
              </td>
              <td>{{ formatDate(model.createdAt) }}</td>
              <td>{{ formatDate(model.activatedAt) }}</td>
              <td>
                <div class="row-actions">
                  <template v-if="model.status === 'ACTIVE'">
                    <button type="button" class="btn ghost" @click="openView(model)">View</button>
                    <button
                      type="button"
                      class="btn primary"
                      :disabled="busy"
                      data-testid="duplicate-as-draft"
                      @click="duplicateAsDraft(model)"
                    >
                      Duplicate as Draft
                    </button>
                  </template>
                  <template v-else-if="model.status === 'DRAFT'">
                    <button
                      type="button"
                      class="btn primary"
                      data-testid="edit-tune"
                      @click="openTune(model)"
                    >
                      Edit / Tune
                    </button>
                    <button
                      type="button"
                      class="btn ghost"
                      data-testid="activate-draft"
                      @click="requestActivate(model)"
                    >
                      Activate
                    </button>
                    <button
                      type="button"
                      class="btn ghost danger"
                      data-testid="delete-draft"
                      @click="requestDelete(model)"
                    >
                      Delete
                    </button>
                  </template>
                  <template v-else>
                    <button type="button" class="btn ghost" @click="openView(model)">View</button>
                  </template>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <div
      v-if="showActivateConfirm && activateTarget"
      class="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="activate-title"
      data-testid="activate-confirm-modal"
    >
      <div class="modal">
        <h2 id="activate-title">Activate production model?</h2>
        <p>
          Activating <strong>{{ activateTarget.name }}</strong> (version {{ activateTarget.version }})
          makes it the global production scoring model and archives the current active model
          <template v-if="activeModel"> ({{ activeModel.name }} v{{ activeModel.version }})</template>.
        </p>
        <p class="warn">This changes how Trust Scores are calculated for everyone.</p>
        <div class="modal-actions">
          <button
            type="button"
            class="btn ghost"
            :disabled="activating"
            @click="showActivateConfirm = false"
          >
            Cancel
          </button>
          <button
            type="button"
            class="btn primary"
            :disabled="activating"
            data-testid="confirm-activate"
            @click="confirmActivate"
          >
            {{ activating ? "Activating…" : "Confirm activation" }}
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="showDeleteConfirm && deleteTarget"
      class="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-title"
      data-testid="delete-confirm-modal"
    >
      <div class="modal">
        <h2 id="delete-title">Delete draft?</h2>
        <p>
          Permanently delete draft <strong>{{ deleteTarget.name }}</strong> (version
          {{ deleteTarget.version }})? Only unused drafts can be deleted.
        </p>
        <StatusBanner v-if="deleteError" tone="error">{{ deleteError }}</StatusBanner>
        <div class="modal-actions">
          <button type="button" class="btn ghost" :disabled="deleting" @click="showDeleteConfirm = false">
            Cancel
          </button>
          <button
            type="button"
            class="btn primary danger"
            :disabled="deleting"
            data-testid="confirm-delete"
            @click="confirmDelete"
          >
            {{ deleting ? "Deleting…" : "Delete draft" }}
          </button>
        </div>
      </div>
    </div>
  </main>
</template>

<style scoped>
.admin-page {
  max-width: 72rem;
  margin: 0 auto;
  padding: var(--space-8) var(--space-4) var(--space-16);
  display: grid;
  gap: var(--space-6);
}

.admin-page__header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: var(--space-4);
  align-items: flex-start;
}

.eyebrow {
  margin: 0 0 var(--space-2);
  font-size: var(--text-xs);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-amber-400);
  font-weight: 700;
}

h1 {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--text-3xl);
  color: var(--color-text);
}

.lede {
  margin: var(--space-3) 0 0;
  max-width: 40rem;
  color: var(--color-text-muted);
  line-height: 1.5;
}

.header-actions,
.row-actions,
.modal-actions,
.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
}

.panel {
  padding: var(--space-5);
  border-radius: var(--radius-card);
  border: 1px solid var(--color-border);
  background:
    linear-gradient(180deg, rgb(255 255 255 / 3%), transparent 40%),
    var(--color-surface);
}

.toolbar {
  margin-bottom: var(--space-4);
}

.search input,
.filter select {
  appearance: none;
  padding: 0.55rem 0.75rem;
  border-radius: var(--radius-control);
  border: 1px solid var(--color-border);
  background: var(--color-bg-elevated);
  color: var(--color-text);
  font: inherit;
  font-size: var(--text-sm);
  min-width: 12rem;
}

.search input:focus-visible,
.filter select:focus-visible {
  outline: none;
  border-color: var(--color-focus);
  box-shadow: 0 0 0 2px rgb(251 191 36 / 35%);
}

.table-wrap {
  overflow-x: auto;
}

.models-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
}

.models-table th,
.models-table td {
  text-align: left;
  padding: var(--space-3) var(--space-2);
  border-bottom: 1px solid var(--color-border);
  vertical-align: middle;
}

.models-table th {
  color: var(--color-text-muted);
  font-weight: 600;
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.model-name {
  font-weight: 600;
  color: var(--color-text);
}

.model-meta {
  color: var(--color-text-muted);
  font-family: var(--font-data);
  font-size: var(--text-xs);
  margin-top: 0.15rem;
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  padding: 0.45rem 0.85rem;
  border-radius: var(--radius-control);
  border: 1px solid var(--color-border);
  background: transparent;
  color: var(--color-text);
  font: inherit;
  font-size: var(--text-sm);
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
}

.btn:hover:not(:disabled) {
  background: var(--color-surface-hover);
}

.btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px rgb(251 191 36 / 40%);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn.primary {
  background: var(--color-brand);
  border-color: transparent;
  color: #111;
}

.btn.primary:hover:not(:disabled) {
  background: var(--color-brand-hover);
}

.btn.danger,
.btn.primary.danger {
  color: var(--color-danger-500);
}

.btn.primary.danger {
  background: var(--color-danger-500);
  color: #fff;
}

.empty {
  padding: var(--space-8) var(--space-4);
  text-align: center;
  color: var(--color-text-muted);
}

.empty h2 {
  margin: 0 0 var(--space-2);
  color: var(--color-text);
  font-size: var(--text-lg);
}

.skeletons {
  display: grid;
  gap: var(--space-3);
}

.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  padding: var(--space-4);
  background: rgb(0 0 0 / 65%);
}

.modal {
  width: min(32rem, 100%);
  padding: var(--space-6);
  border-radius: var(--radius-card);
  border: 1px solid var(--color-border);
  background: var(--color-bg-elevated);
  display: grid;
  gap: var(--space-3);
}

.modal h2 {
  margin: 0;
  font-size: var(--text-xl);
}

.modal p {
  margin: 0;
  color: var(--color-text-muted);
  line-height: 1.5;
}

.warn {
  color: var(--color-amber-400) !important;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  border: 0;
}

@media (max-width: 720px) {
  .models-table th:nth-child(3),
  .models-table td:nth-child(3),
  .models-table th:nth-child(4),
  .models-table td:nth-child(4) {
    display: none;
  }
}
</style>
