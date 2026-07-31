<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { api } from "../api/client";
import type {
  ActivateScoreModelResult,
  AdminScoreModelDTO,
  BacktestSummary,
  ModelValidationResult,
  ScoreModelDependencyCounts,
} from "../api/types";
import {
  getMetricMetadata,
  METRIC_WEIGHT_DIMENSIONS,
  parsePersistedModelConfig,
  toPersistedConfig,
  validateModelConfigForm,
  type ModelConfigFormState,
} from "../api/model-config";
import { deepClone } from "../lib/clone";
import StatusBanner from "../components/common/StatusBanner.vue";
import FieldTooltip from "../components/common/FieldTooltip.vue";
import { ApiClientError } from "../api/live-client";
import * as tip from "./adminModelsTooltips";

const router = useRouter();
const models = ref<AdminScoreModelDTO[]>([]);
const selectedId = ref<string | null>(null);
const draftForm = ref<ModelConfigFormState | null>(null);
const draftBase = ref<Record<string, unknown> | null>(null);
const configDiagnostic = ref<string | null>(null);
const validation = ref<ModelValidationResult | null>(null);
const backtest = ref<BacktestSummary | null>(null);
const activationResult = ref<ActivateScoreModelResult | null>(null);
const message = ref<string | null>(null);
const error = ref<string | null>(null);
const loadError = ref<string | null>(null);
const busy = ref(false);
const loading = ref(true);
const showActivateConfirm = ref(false);
const activating = ref(false);

type StatusFilter = "ALL" | "ACTIVE" | "DRAFT" | "ARCHIVED";
const catalogQuery = ref("");
const catalogStatus = ref<StatusFilter>("ALL");
const rowEls = ref<Record<string, HTMLTableRowElement | null>>({});

const deleteTarget = ref<AdminScoreModelDTO | null>(null);
const showDeleteConfirm = ref(false);
const deleting = ref(false);
const deleteError = ref<string | null>(null);
const deleteConflictCounts = ref<ScoreModelDependencyCounts | null>(null);

const selected = computed(() => models.value.find((m) => m.id === selectedId.value) ?? null);
const isDraft = computed(() => selected.value?.status === "DRAFT");
const activeModel = computed(() => models.value.find((m) => m.status === "ACTIVE") ?? null);
const archivedModels = computed(() => models.value.filter((m) => m.status === "ARCHIVED"));
const configEditable = computed(() => draftForm.value !== null && draftBase.value !== null);
const isEmptyCatalog = computed(() => !loading.value && !loadError.value && models.value.length === 0);

const STATUS_RANK: Record<AdminScoreModelDTO["status"], number> = { ACTIVE: 0, DRAFT: 1, ARCHIVED: 2 };

/** Text search (name/key/version) + status filter, then ACTIVE → DRAFT newest → ARCHIVED newest. */
const filteredModels = computed(() => {
  const q = catalogQuery.value.trim().toLowerCase();
  return models.value.filter((m) => {
    if (catalogStatus.value !== "ALL" && m.status !== catalogStatus.value) return false;
    if (!q) return true;
    return (
      m.name.toLowerCase().includes(q) ||
      m.key.toLowerCase().includes(q) ||
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

const hasActiveFilters = computed(() => catalogQuery.value.trim().length > 0 || catalogStatus.value !== "ALL");
const selectedHiddenByFilters = computed(
  () => selected.value !== null && !sortedModels.value.some((m) => m.id === selected.value!.id),
);

function resetFilters(): void {
  catalogQuery.value = "";
  catalogStatus.value = "ALL";
}

const weightSum = computed(() => {
  const w = draftForm.value?.weights;
  if (!w) return 0;
  return (
    w.performance + w.survival + w.utility + w.experienceConsistency + w.mythicRaid
  );
});

const readOnlyOverallFormula = computed(() => {
  const v = draftBase.value?.overallFormula;
  return typeof v === "string" ? v : null;
});

const readOnlyEligibility = computed(() => {
  const v = draftBase.value?.eligibility;
  return v !== null && typeof v === "object" ? (v as Record<string, unknown>) : null;
});

const readOnlyUtilityEligibility = computed(() => {
  const v = draftBase.value?.utilityPublicationEligibility;
  return v !== null && typeof v === "object" ? (v as Record<string, unknown>) : null;
});

function statusClass(status: string): string {
  if (status === "ACTIVE") return "status-active";
  if (status === "DRAFT") return "status-draft";
  return "status-archived";
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString();
  } catch {
    return value;
  }
}

function handleAuthError(err: unknown): boolean {
  if (err instanceof ApiClientError && (err.status === 401 || err.status === 403)) {
    void router.replace(err.status === 401 ? "/auth/signin" : "/access-denied");
    return true;
  }
  return false;
}

function buildPersistedPayload(): Record<string, unknown> | null {
  if (!draftForm.value || !draftBase.value || !selected.value) return null;
  return toPersistedConfig(draftForm.value, draftBase.value, {
    key: selected.value.key,
    version: selected.value.version,
  });
}

function applyParsedConfig(raw: unknown): void {
  const parsed = parsePersistedModelConfig(raw);
  if (!parsed.ok) {
    draftForm.value = null;
    draftBase.value = null;
    configDiagnostic.value = parsed.diagnostic;
    return;
  }
  draftForm.value = deepClone(parsed.form);
  draftBase.value = parsed.base;
  configDiagnostic.value = null;
}

/** Fetch models only — no selection side effects (used by delete's custom reselect logic). */
async function fetchModels(): Promise<void> {
  models.value = await api.listModels();
}

async function loadModels(): Promise<void> {
  await fetchModels();
  if (!selectedId.value && models.value[0]) {
    selectModel(models.value[0].id);
  } else if (selectedId.value) {
    const still = models.value.find((m) => m.id === selectedId.value);
    if (!still && models.value[0]) selectModel(models.value[0].id);
    else if (still) selectModel(still.id);
  }
}

function clearEditorState(): void {
  selectedId.value = null;
  draftForm.value = null;
  draftBase.value = null;
  configDiagnostic.value = null;
  validation.value = null;
  backtest.value = null;
  activationResult.value = null;
  showActivateConfirm.value = false;
}

function selectModel(id: string): void {
  selectedId.value = id;
  const model = models.value.find((m) => m.id === id);
  applyParsedConfig(model?.config);
  validation.value = null;
  backtest.value = null;
  activationResult.value = null;
  showActivateConfirm.value = false;
  message.value = null;
  error.value = null;
}

function focusRow(id: string): void {
  rowEls.value[id]?.focus();
}

function onRowKeydown(event: KeyboardEvent, index: number): void {
  const rows = sortedModels.value;
  if (event.key === "ArrowDown") {
    event.preventDefault();
    const next = rows[index + 1];
    if (next) focusRow(next.id);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    const prev = rows[index - 1];
    if (prev) focusRow(prev.id);
  } else if (event.key === "Home") {
    event.preventDefault();
    const first = rows[0];
    if (first) focusRow(first.id);
  } else if (event.key === "End") {
    event.preventDefault();
    const last = rows[rows.length - 1];
    if (last) focusRow(last.id);
  } else if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    const row = rows[index];
    if (row) selectModel(row.id);
  }
}

async function cloneActive(): Promise<void> {
  const active = activeModel.value;
  if (!active) {
    error.value = "No active model to clone.";
    return;
  }
  busy.value = true;
  error.value = null;
  try {
    const draft = await api.cloneModel(active.id);
    await loadModels();
    selectModel(draft.id);
    message.value = `Cloned draft ${draft.name} (v${draft.version})`;
  } catch (err) {
    if (!handleAuthError(err)) error.value = (err as Error).message;
  } finally {
    busy.value = false;
  }
}

function runLocalValidate(): void {
  if (!draftForm.value) {
    validation.value = {
      valid: false,
      errors: [configDiagnostic.value ?? "No editable configuration"],
      weightSum: 0,
    };
    return;
  }
  validation.value = validateModelConfigForm(draftForm.value);
}

async function runServerValidate(): Promise<void> {
  if (!selected.value) return;
  const payload = buildPersistedPayload();
  if (!payload) {
    error.value = configDiagnostic.value ?? "Cannot validate malformed configuration.";
    return;
  }
  busy.value = true;
  error.value = null;
  try {
    if (isDraft.value) {
      await api.updateModel(selected.value.id, payload);
    }
    const result = await api.validateModel(selected.value.id, payload);
    validation.value = {
      valid: result.valid,
      errors: result.errors,
      weightSum: weightSum.value,
    };
    message.value = result.valid ? "Server validation passed." : "Server validation failed.";
  } catch (err) {
    if (!handleAuthError(err)) error.value = (err as Error).message;
  } finally {
    busy.value = false;
  }
}

async function saveDraft(): Promise<void> {
  if (!selected.value || !isDraft.value) return;
  const payload = buildPersistedPayload();
  if (!payload || !draftForm.value) {
    error.value = configDiagnostic.value ?? "Cannot save malformed configuration.";
    return;
  }
  runLocalValidate();
  if (!validation.value?.valid) {
    error.value = "Fix validation errors before saving.";
    return;
  }
  busy.value = true;
  try {
    await api.updateModel(selected.value.id, payload);
    await loadModels();
    message.value = "Draft saved.";
  } catch (err) {
    if (!handleAuthError(err)) error.value = (err as Error).message;
  } finally {
    busy.value = false;
  }
}

async function runBacktest(): Promise<void> {
  if (!selected.value) return;
  const payload = buildPersistedPayload();
  if (!payload && isDraft.value) {
    error.value = configDiagnostic.value ?? "Cannot backtest malformed configuration.";
    return;
  }
  busy.value = true;
  error.value = null;
  try {
    if (isDraft.value && payload) {
      await api.updateModel(selected.value.id, payload);
    }
    backtest.value = await api.backtestModel(selected.value.id);
    message.value = `Cohort backtest complete (${backtest.value.cohortSize} characters, mode ${backtest.value.mode ?? "unknown"}).`;
  } catch (err) {
    if (!handleAuthError(err)) error.value = (err as Error).message;
  } finally {
    busy.value = false;
  }
}

function openActivateConfirm(): void {
  if (!selected.value || !isDraft.value) return;
  runLocalValidate();
  if (!validation.value?.valid) {
    error.value = "Cannot activate invalid weights.";
    return;
  }
  showActivateConfirm.value = true;
}

async function confirmActivate(): Promise<void> {
  if (!selected.value || !isDraft.value || activating.value) return;
  const payload = buildPersistedPayload();
  if (!payload) {
    error.value = configDiagnostic.value ?? "Cannot activate malformed configuration.";
    return;
  }
  activating.value = true;
  busy.value = true;
  error.value = null;
  try {
    await api.updateModel(selected.value.id, payload);
    const result = await api.activateModel(selected.value.id, {
      confirm: true,
      expectedPreviousActiveId: activeModel.value?.id ?? null,
    });
    activationResult.value = result;
    showActivateConfirm.value = false;
    await loadModels();
    selectModel(result.id);
    if (result.bulkEnqueueError) {
      message.value = `Model activated, but bulk recalculation enqueue failed: ${result.bulkEnqueueError}`;
      error.value =
        "Retry RECALCULATE_ONLY from Admin → Bulk processing using this score model id.";
    } else {
      message.value = result.bulkOperationId
        ? `Model activated. Recalculate job ${result.bulkOperationId} enqueued.`
        : "Model activated.";
    }
  } catch (err) {
    if (!handleAuthError(err)) error.value = (err as Error).message;
  } finally {
    activating.value = false;
    busy.value = false;
  }
}

function openDeleteConfirm(model: AdminScoreModelDTO): void {
  if (model.status !== "DRAFT" || deleting.value) return;
  deleteTarget.value = model;
  deleteError.value = null;
  deleteConflictCounts.value = null;
  showDeleteConfirm.value = true;
}

function cancelDelete(): void {
  if (deleting.value) return;
  showDeleteConfirm.value = false;
  deleteTarget.value = null;
  deleteError.value = null;
  deleteConflictCounts.value = null;
}

function formatDependencyCounts(counts: ScoreModelDependencyCounts): string {
  const parts: string[] = [];
  if (counts.scoreSnapshots) parts.push(`${counts.scoreSnapshots} score snapshot(s)`);
  if (counts.characterRedFlags) parts.push(`${counts.characterRedFlags} red flag record(s)`);
  if (counts.addonExports) parts.push(`${counts.addonExports} addon export(s)`);
  if (counts.analysisBatches) parts.push(`${counts.analysisBatches} analysis batch(es)`);
  if (counts.bulkOperations) parts.push(`${counts.bulkOperations} bulk operation(s)`);
  return parts.length ? parts.join(", ") : "durable history";
}

async function confirmDelete(): Promise<void> {
  if (!deleteTarget.value || deleting.value) return;
  const target = deleteTarget.value;
  deleting.value = true;
  deleteError.value = null;
  deleteConflictCounts.value = null;
  try {
    const result = await api.deleteModel(target.id);
    const wasSelected = selectedId.value === target.id;
    showDeleteConfirm.value = false;
    deleteTarget.value = null;
    await fetchModels();
    if (wasSelected || !models.value.some((m) => m.id === selectedId.value)) {
      const preferred = models.value.find((m) => m.status === "ACTIVE") ?? sortedModels.value[0] ?? models.value[0];
      if (preferred) selectModel(preferred.id);
      else clearEditorState();
    }
    message.value = `Deleted draft ${result.name} (v${result.version}).`;
    error.value = null;
  } catch (err) {
    const details = err as { status?: number; code?: string; details?: { counts?: ScoreModelDependencyCounts }; message?: string };
    if (details.code === "SCORE_MODEL_DRAFT_IN_USE" && details.details?.counts) {
      deleteConflictCounts.value = details.details.counts;
      deleteError.value = `This draft is referenced by durable history and cannot be deleted: ${formatDependencyCounts(details.details.counts)}.`;
    } else if (!handleAuthError(err)) {
      deleteError.value = (err as Error).message;
    }
  } finally {
    deleting.value = false;
  }
}

onMounted(() => {
  void loadModels()
    .then(() => {
      loadError.value = null;
    })
    .catch((err) => {
      if (!handleAuthError(err)) {
        loadError.value = (err as Error).message;
      }
    })
    .finally(() => {
      loading.value = false;
    });
});
</script>

<template>
  <section data-testid="admin-page">
    <h1>Admin score models</h1>
    <p>
      Draft, validate, backtest, and activate immutable model versions. Requires an authenticated
      Battle.net session with admin permissions — no API keys in the browser. The database ACTIVE
      row is authoritative; no VPS <code>.env</code> edit is required for activation.
    </p>

    <StatusBanner v-if="loading" tone="info" data-testid="models-loading">Loading score models…</StatusBanner>
    <StatusBanner v-else-if="loadError" tone="error" data-testid="models-load-error">
      {{ loadError }}
    </StatusBanner>
    <StatusBanner v-else-if="isEmptyCatalog" tone="warn" data-testid="models-empty">
      No score models in the catalog. Seed the database or create a draft via the API.
    </StatusBanner>

    <template v-if="!loading && !loadError">
      <StatusBanner v-if="message" tone="success" data-testid="page-message">{{ message }}</StatusBanner>
      <StatusBanner v-if="error" tone="error" data-testid="page-error">{{ error }}</StatusBanner>

      <div class="toolbar">
        <button
          type="button"
          class="btn"
          data-testid="clone-model"
          :disabled="busy || !activeModel"
          @click="cloneActive"
        >
          Clone active → draft
        </button>
        <FieldTooltip
          :what-it-means="tip.ACTION_CLONE.whatItMeans"
          :technical="tip.ACTION_CLONE.technical"
          label="About cloning the active model"
        />
        <RouterLink class="btn link" to="/admin/bulk-processing">Bulk processing</RouterLink>
      </div>

      <div class="layout">
        <aside class="catalog" data-testid="model-catalog">
          <h2>Catalog</h2>

          <div class="catalog-filters">
            <label class="catalog-search">
              <span class="label-row">
                <span class="label">Search</span>
                <FieldTooltip
                  :what-it-means="tip.CATALOG_SEARCH.whatItMeans"
                  :technical="tip.CATALOG_SEARCH.technical"
                  label="About catalog search"
                />
              </span>
              <input
                v-model="catalogQuery"
                class="admin-control"
                type="search"
                placeholder="Name, key, or version"
                data-testid="catalog-search"
                autocomplete="off"
              />
            </label>
            <label class="catalog-status">
              <span class="label-row">
                <span class="label">Status</span>
                <FieldTooltip
                  :what-it-means="tip.CATALOG_STATUS_FILTER.whatItMeans"
                  :technical="tip.CATALOG_STATUS_FILTER.technical"
                  label="About the status filter"
                />
              </span>
              <select v-model="catalogStatus" class="admin-control" data-testid="catalog-status-filter">
                <option value="ALL">All statuses</option>
                <option value="ACTIVE">Active</option>
                <option value="DRAFT">Draft</option>
                <option value="ARCHIVED">Archived</option>
              </select>
            </label>
            <button
              type="button"
              class="btn secondary catalog-reset"
              data-testid="catalog-reset"
              :disabled="!hasActiveFilters"
              @click="resetFilters"
            >
              Clear filters
            </button>
          </div>

          <p class="muted tiny catalog-count" data-testid="catalog-result-count">
            Showing {{ sortedModels.length }} of {{ models.length }} model(s)
            <FieldTooltip
              :what-it-means="tip.CATALOG_ORDER.whatItMeans"
              :technical="tip.CATALOG_ORDER.technical"
              label="About catalog ordering"
            />
          </p>

          <p v-if="selectedHiddenByFilters" class="muted tiny catalog-hidden-note" data-testid="selected-hidden-note">
            Selected model is hidden by the current filters.
            <button type="button" class="btn link" @click="resetFilters">Clear filters</button>
            to see it in the catalog.
          </p>

          <div class="catalog-table-scroll" data-testid="model-list">
            <table v-if="sortedModels.length" class="catalog-table">
              <thead>
                <tr>
                  <th scope="col">Status</th>
                  <th scope="col">Name</th>
                  <th scope="col">Key</th>
                  <th scope="col">Version</th>
                  <th scope="col">Created</th>
                  <th scope="col">Activated</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(m, index) in sortedModels"
                  :key="m.id"
                  :ref="(el) => { rowEls[m.id] = el as HTMLTableRowElement | null }"
                  class="catalog-row"
                  :class="{ 'catalog-row--selected': m.id === selectedId }"
                  tabindex="0"
                  data-testid="catalog-row"
                  :aria-selected="m.id === selectedId ? 'true' : 'false'"
                  @click="selectModel(m.id)"
                  @keydown="onRowKeydown($event, index)"
                >
                  <td>
                    <span class="badge" :class="statusClass(m.status)">{{ m.status }}</span>
                    <FieldTooltip
                      :what-it-means="tip.STATUS_BADGE[m.status].whatItMeans"
                      :technical="tip.STATUS_BADGE[m.status].technical"
                      :label="`About ${m.status} status`"
                    />
                  </td>
                  <td>{{ m.name }}</td>
                  <td class="catalog-key">{{ m.key }}</td>
                  <td>v{{ m.version }}</td>
                  <td>{{ formatDate(m.createdAt) }}</td>
                  <td>{{ formatDate(m.activatedAt) }}</td>
                  <td>
                    <button
                      v-if="m.status === 'DRAFT'"
                      type="button"
                      class="btn danger small"
                      data-testid="delete-draft-row"
                      :disabled="deleting"
                      @click.stop="openDeleteConfirm(m)"
                    >
                      Delete draft
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
            <p v-else class="muted tiny catalog-empty" data-testid="catalog-empty-filters">
              No models match the current filters.
              <button type="button" class="btn link" @click="resetFilters">Clear filters</button>
            </p>
          </div>

          <p v-if="archivedModels.length" class="muted tiny">
            {{ archivedModels.length }} archived version(s) — immutable.
          </p>
        </aside>

        <div v-if="selected" class="editor" data-testid="model-editor">
          <h2>{{ selected.name }}</h2>
          <p class="muted">
            <span class="badge" :class="statusClass(selected.status)" data-testid="selected-status">
              {{ selected.status }}
            </span>
            · key {{ selected.key }} · version {{ selected.version }}
            <template v-if="selected.activatedAt"> · activated {{ selected.activatedAt }}</template>
          </p>
          <p v-if="!isDraft" class="muted">This version is immutable. Clone the active model to edit.</p>

          <StatusBanner
            v-if="configDiagnostic"
            tone="warn"
            data-testid="config-malformed"
          >
            {{ configDiagnostic }}
          </StatusBanner>

          <template v-if="configEditable && draftForm">
            <fieldset :disabled="!isDraft">
              <legend>
                Dimension weights
                <FieldTooltip
                  :what-it-means="tip.WEIGHTS_GROUP.whatItMeans"
                  :technical="tip.WEIGHTS_GROUP.technical"
                  label="About dimension weights"
                />
              </legend>
              <label>
                <span class="label-row">
                  performance
                  <FieldTooltip
                    :what-it-means="tip.WEIGHT_FIELD.performance.whatItMeans"
                    :technical="tip.WEIGHT_FIELD.performance.technical"
                    label="About the performance weight"
                  />
                </span>
                <input
                  v-model.number="draftForm.weights.performance"
                  type="number"
                  step="0.01"
                  min="0"
                  max="1"
                  data-testid="weight-performance"
                />
              </label>
              <label>
                <span class="label-row">
                  survival
                  <FieldTooltip
                    :what-it-means="tip.WEIGHT_FIELD.survival.whatItMeans"
                    :technical="tip.WEIGHT_FIELD.survival.technical"
                    label="About the survival weight"
                  />
                </span>
                <input
                  v-model.number="draftForm.weights.survival"
                  type="number"
                  step="0.01"
                  min="0"
                  max="1"
                />
              </label>
              <label>
                <span class="label-row">
                  utility
                  <FieldTooltip
                    :what-it-means="tip.WEIGHT_FIELD.utility.whatItMeans"
                    :technical="tip.WEIGHT_FIELD.utility.technical"
                    label="About the utility weight"
                  />
                </span>
                <input
                  v-model.number="draftForm.weights.utility"
                  type="number"
                  step="0.01"
                  min="0"
                  max="1"
                />
              </label>
              <label>
                <span class="label-row">
                  experienceConsistency
                  <FieldTooltip
                    :what-it-means="tip.WEIGHT_FIELD.experienceConsistency.whatItMeans"
                    :technical="tip.WEIGHT_FIELD.experienceConsistency.technical"
                    label="About the experience weight"
                  />
                </span>
                <input
                  v-model.number="draftForm.weights.experienceConsistency"
                  type="number"
                  step="0.01"
                  min="0"
                  max="1"
                />
              </label>
              <label>
                <span class="label-row">
                  mythicRaid
                  <FieldTooltip
                    :what-it-means="tip.WEIGHT_FIELD.mythicRaid.whatItMeans"
                    :technical="tip.WEIGHT_FIELD.mythicRaid.technical"
                    label="About the mythic raid weight"
                  />
                </span>
                <input
                  v-model.number="draftForm.weights.mythicRaid"
                  type="number"
                  step="0.01"
                  min="0"
                  max="1"
                />
              </label>
            </fieldset>

            <fieldset
              v-for="dim in METRIC_WEIGHT_DIMENSIONS"
              :key="dim"
              :disabled="!isDraft"
              :data-testid="`metric-weights-${dim}`"
            >
              <legend>
                Metric weights ({{ dim }})
                <FieldTooltip
                  :what-it-means="tip.METRIC_WEIGHTS_GROUP[dim].whatItMeans"
                  :technical="tip.METRIC_WEIGHTS_GROUP[dim].technical"
                  :label="`About ${dim} metric weights`"
                />
              </legend>
              <label v-for="(entry, idx) in draftForm.metricWeights[dim]" :key="`${dim}-${entry.metricKey}-${idx}`">
                <span class="label-row">
                  {{ entry.metricKey }}
                  <FieldTooltip
                    :what-it-means="getMetricMetadata(entry.metricKey, dim).whatItMeans"
                    :technical="getMetricMetadata(entry.metricKey, dim).technical"
                    :label="`About ${getMetricMetadata(entry.metricKey, dim).label}`"
                  />
                </span>
                <input
                  v-model.number="entry.weight"
                  type="number"
                  step="0.01"
                  min="0"
                  max="1"
                />
              </label>
            </fieldset>

            <fieldset :disabled="!isDraft">
              <legend>
                Grade thresholds
                <FieldTooltip
                  :what-it-means="tip.GRADE_THRESHOLDS_GROUP.whatItMeans"
                  :technical="tip.GRADE_THRESHOLDS_GROUP.technical"
                  label="About grade thresholds"
                />
              </legend>
              <label>
                <span class="label-row">
                  S
                  <FieldTooltip
                    :what-it-means="tip.GRADE_THRESHOLD_FIELD.S.whatItMeans"
                    :technical="tip.GRADE_THRESHOLD_FIELD.S.technical"
                    label="About the S grade threshold"
                  />
                </span>
                <input v-model.number="draftForm.gradeThresholds.S" type="number" step="1" min="0" max="100" />
              </label>
              <label>
                <span class="label-row">
                  A
                  <FieldTooltip
                    :what-it-means="tip.GRADE_THRESHOLD_FIELD.A.whatItMeans"
                    :technical="tip.GRADE_THRESHOLD_FIELD.A.technical"
                    label="About the A grade threshold"
                  />
                </span>
                <input v-model.number="draftForm.gradeThresholds.A" type="number" step="1" min="0" max="100" />
              </label>
              <label>
                <span class="label-row">
                  B
                  <FieldTooltip
                    :what-it-means="tip.GRADE_THRESHOLD_FIELD.B.whatItMeans"
                    :technical="tip.GRADE_THRESHOLD_FIELD.B.technical"
                    label="About the B grade threshold"
                  />
                </span>
                <input v-model.number="draftForm.gradeThresholds.B" type="number" step="1" min="0" max="100" />
              </label>
              <label>
                <span class="label-row">
                  C
                  <FieldTooltip
                    :what-it-means="tip.GRADE_THRESHOLD_FIELD.C.whatItMeans"
                    :technical="tip.GRADE_THRESHOLD_FIELD.C.technical"
                    label="About the C grade threshold"
                  />
                </span>
                <input v-model.number="draftForm.gradeThresholds.C" type="number" step="1" min="0" max="100" />
              </label>
            </fieldset>

            <fieldset v-if="draftForm.minConfidenceForGrade !== null" :disabled="!isDraft">
              <legend>
                Confidence for grade
                <FieldTooltip
                  :what-it-means="tip.CONFIDENCE_FOR_GRADE.whatItMeans"
                  :technical="tip.CONFIDENCE_FOR_GRADE.technical"
                  label="About confidence for grade"
                />
              </legend>
              <label>
                <span class="label-row">
                  minConfidenceForGrade
                </span>
                <input
                  v-model.number="draftForm.minConfidenceForGrade"
                  type="number"
                  step="0.01"
                  min="0"
                  max="1"
                  data-testid="min-confidence-for-grade"
                />
              </label>
            </fieldset>

            <fieldset :disabled="!isDraft">
              <legend>
                Authenticity blend
                <FieldTooltip
                  :what-it-means="tip.AUTHENTICITY_BLEND_GROUP.whatItMeans"
                  :technical="tip.AUTHENTICITY_BLEND_GROUP.technical"
                  label="About the authenticity blend"
                />
              </legend>
              <label>
                <span class="label-row">
                  skillWeight
                  <FieldTooltip
                    :what-it-means="tip.AUTHENTICITY_BLEND_FIELD.skillWeight.whatItMeans"
                    :technical="tip.AUTHENTICITY_BLEND_FIELD.skillWeight.technical"
                    label="About skill weight"
                  />
                </span>
                <input
                  v-model.number="draftForm.authenticityBlend.skillWeight"
                  type="number"
                  step="0.01"
                  min="0"
                  max="1"
                />
              </label>
              <label>
                <span class="label-row">
                  authenticityWeight
                  <FieldTooltip
                    :what-it-means="tip.AUTHENTICITY_BLEND_FIELD.authenticityWeight.whatItMeans"
                    :technical="tip.AUTHENTICITY_BLEND_FIELD.authenticityWeight.technical"
                    label="About authenticity weight"
                  />
                </span>
                <input
                  v-model.number="draftForm.authenticityBlend.authenticityWeight"
                  type="number"
                  step="0.01"
                  min="0"
                  max="1"
                />
              </label>
              <label>
                <span class="label-row">
                  confidenceNeutralScore
                  <FieldTooltip
                    :what-it-means="tip.AUTHENTICITY_BLEND_FIELD.confidenceNeutralScore.whatItMeans"
                    :technical="tip.AUTHENTICITY_BLEND_FIELD.confidenceNeutralScore.technical"
                    label="About confidence-neutral score"
                  />
                </span>
                <input
                  v-model.number="draftForm.confidenceNeutralScore"
                  type="number"
                  step="1"
                  min="0"
                  max="100"
                />
              </label>
            </fieldset>

            <fieldset v-if="draftForm.authenticityTags" :disabled="!isDraft" data-testid="authenticity-tags">
              <legend>
                Authenticity tags (persisted)
                <FieldTooltip
                  :what-it-means="tip.AUTHENTICITY_TAGS_GROUP.whatItMeans"
                  :technical="tip.AUTHENTICITY_TAGS_GROUP.technical"
                  label="About authenticity tags"
                />
              </legend>
              <label>
                <span class="label-row">
                  boostSuspectedBelow
                  <FieldTooltip
                    :what-it-means="tip.AUTHENTICITY_TAGS_FIELD.boostSuspectedBelow.whatItMeans"
                    :technical="tip.AUTHENTICITY_TAGS_FIELD.boostSuspectedBelow.technical"
                    label="About boost-suspected threshold"
                  />
                </span>
                <input
                  v-model.number="draftForm.authenticityTags.boostSuspectedBelow"
                  type="number"
                  step="1"
                  data-testid="boost-soft"
                />
              </label>
              <label>
                <span class="label-row">
                  atypicalBelow
                  <FieldTooltip
                    :what-it-means="tip.AUTHENTICITY_TAGS_FIELD.atypicalBelow.whatItMeans"
                    :technical="tip.AUTHENTICITY_TAGS_FIELD.atypicalBelow.technical"
                    label="About atypical-progression threshold"
                  />
                </span>
                <input
                  v-model.number="draftForm.authenticityTags.atypicalBelow"
                  type="number"
                  step="1"
                />
              </label>
            </fieldset>
            <p v-else class="muted tiny" data-testid="authenticity-tags-absent">
              Authenticity tag thresholds are not configured on this persisted model (scoring
              runtime may apply package defaults at calculate time).
            </p>

            <div class="readonly-meta" data-testid="canonical-readonly">
              <h3>Canonical (read-only)</h3>
              <p v-if="readOnlyOverallFormula" class="muted tiny">
                overallFormula: <code>{{ readOnlyOverallFormula }}</code>
                <FieldTooltip
                  :what-it-means="tip.CANONICAL_OVERALL_FORMULA.whatItMeans"
                  :technical="tip.CANONICAL_OVERALL_FORMULA.technical"
                  label="About the overall formula"
                />
              </p>
              <p v-if="readOnlyUtilityEligibility" class="muted tiny">
                utilityPublicationEligibility:
                <code>{{ JSON.stringify(readOnlyUtilityEligibility) }}</code>
                <FieldTooltip
                  :what-it-means="tip.CANONICAL_UTILITY_ELIGIBILITY.whatItMeans"
                  :technical="tip.CANONICAL_UTILITY_ELIGIBILITY.technical"
                  label="About utility publication eligibility"
                />
              </p>
              <p v-if="readOnlyEligibility" class="muted tiny">
                eligibility: <code>{{ JSON.stringify(readOnlyEligibility) }}</code>
                <FieldTooltip
                  :what-it-means="tip.CANONICAL_ELIGIBILITY.whatItMeans"
                  :technical="tip.CANONICAL_ELIGIBILITY.technical"
                  label="About scoring eligibility"
                />
              </p>
            </div>

            <div class="actions">
              <button type="button" class="btn" data-testid="validate-model" @click="runLocalValidate">
                Validate local
              </button>
              <FieldTooltip
                :what-it-means="tip.ACTION_VALIDATE_LOCAL.whatItMeans"
                :technical="tip.ACTION_VALIDATE_LOCAL.technical"
                label="About local validation"
              />
              <button
                type="button"
                class="btn"
                data-testid="server-validate-model"
                :disabled="busy"
                @click="runServerValidate"
              >
                Server validate
              </button>
              <FieldTooltip
                :what-it-means="tip.ACTION_VALIDATE_SERVER.whatItMeans"
                :technical="tip.ACTION_VALIDATE_SERVER.technical"
                label="About server validation"
              />
              <button type="button" class="btn" :disabled="!isDraft || busy" @click="saveDraft">
                Save draft
              </button>
              <FieldTooltip
                :what-it-means="tip.ACTION_SAVE_DRAFT.whatItMeans"
                :technical="tip.ACTION_SAVE_DRAFT.technical"
                label="About saving the draft"
              />
              <button
                type="button"
                class="btn"
                data-testid="backtest-model"
                :disabled="busy"
                @click="runBacktest"
              >
                Cohort backtest
              </button>
              <FieldTooltip
                :what-it-means="tip.ACTION_BACKTEST.whatItMeans"
                :technical="tip.ACTION_BACKTEST.technical"
                label="About cohort backtest"
              />
              <button
                type="button"
                class="btn primary"
                data-testid="activate-model"
                :disabled="!isDraft || busy || activating"
                @click="openActivateConfirm"
              >
                Activate…
              </button>
              <FieldTooltip
                :what-it-means="tip.ACTION_ACTIVATE.whatItMeans"
                :technical="tip.ACTION_ACTIVATE.technical"
                label="About activation"
              />
              <button
                v-if="isDraft"
                type="button"
                class="btn danger"
                data-testid="delete-draft"
                :disabled="busy || deleting"
                @click="openDeleteConfirm(selected)"
              >
                Delete draft
              </button>
              <FieldTooltip
                v-if="isDraft"
                :what-it-means="tip.ACTION_DELETE_DRAFT.whatItMeans"
                :technical="tip.ACTION_DELETE_DRAFT.technical"
                label="About deleting this draft"
              />
            </div>
          </template>

          <div v-if="showActivateConfirm" class="confirm" data-testid="activate-confirm">
            <h3>Confirm activation</h3>
            <ul>
              <li>Draft <strong>v{{ selected.version }}</strong> becomes ACTIVE.</li>
              <li v-if="activeModel">
                Current ACTIVE <strong>v{{ activeModel.version }}</strong> will be archived.
              </li>
              <li v-else>No previous ACTIVE model for this key.</li>
              <li>
                Enqueues progressive <code>RECALCULATE_ONLY</code> for all persisted characters
                (no provider calls during activation).
              </li>
              <li>Published snapshots stay visible until recalculated replacements publish.</li>
            </ul>
            <div class="actions">
              <button type="button" class="btn" :disabled="activating" @click="showActivateConfirm = false">
                Cancel
              </button>
              <button
                type="button"
                class="btn primary"
                data-testid="confirm-activate"
                :disabled="activating"
                @click="confirmActivate"
              >
                {{ activating ? "Activating…" : "Confirm activate" }}
              </button>
            </div>
          </div>

          <div v-if="activationResult" class="activation-result" data-testid="activation-result">
            <h3>Activation result</h3>
            <p>
              Previous ACTIVE:
              {{
                activationResult.previousActiveVersion != null
                  ? `v${activationResult.previousActiveVersion}`
                  : "none"
              }}
            </p>
            <p v-if="activationResult.bulkOperationId">
              Bulk job:
              <RouterLink
                :to="{ path: '/admin/bulk-processing', query: { op: activationResult.bulkOperationId } }"
                data-testid="bulk-operation-link"
              >
                {{ activationResult.bulkOperationId }}
              </RouterLink>
            </p>
            <p v-if="activationResult.bulkEnqueueError" class="error">
              Enqueue failed: {{ activationResult.bulkEnqueueError }}
            </p>
          </div>

          <div v-if="validation" class="validation" data-testid="validation-result">
            <p>
              Weight sum: <strong>{{ validation.weightSum.toFixed(4) }}</strong> ·
              {{ validation.valid ? "Valid" : "Invalid" }}
            </p>
            <ul v-if="validation.errors.length">
              <li v-for="err in validation.errors" :key="err">{{ err }}</li>
            </ul>
          </div>

          <div v-if="backtest" class="backtest" data-testid="backtest-result">
            <h3>Cohort backtest</h3>
            <p>
              Cohort {{ backtest.cohortSize }} · mean {{ backtest.meanOverall.toFixed(2) }}
              <template v-if="backtest.meanConfidence != null">
                · mean confidence {{ backtest.meanConfidence.toFixed(3) }}
              </template>
              <template v-if="backtest.mode"> · mode {{ backtest.mode }}</template>
              <template v-if="backtest.cohortId"> · cohort {{ backtest.cohortId }}</template>
            </p>
            <p v-if="backtest.degradedReason" class="muted" data-testid="backtest-degraded-reason">
              Degraded: {{ backtest.degradedReason }}
            </p>
            <p class="muted">{{ backtest.notes }}</p>
            <h4>Grade distribution</h4>
            <ul>
              <li v-for="(count, grade) in backtest.gradeDistribution" :key="grade">
                {{ grade }}: {{ count }}
              </li>
            </ul>
          </div>
        </div>
      </div>

      <div v-if="showDeleteConfirm && deleteTarget" class="modal-overlay" data-testid="delete-confirm-overlay">
        <div class="modal delete-confirm" role="dialog" aria-modal="true" aria-labelledby="delete-confirm-title" data-testid="delete-confirm">
          <h3 id="delete-confirm-title">Delete draft?</h3>
          <p>
            <span class="badge" :class="statusClass(deleteTarget.status)">{{ deleteTarget.status }}</span>
            <strong> {{ deleteTarget.name }}</strong> · key {{ deleteTarget.key }} · version {{ deleteTarget.version }}
          </p>
          <ul>
            <li>{{ tip.DELETE_CONFIRM_INTRO.whatItMeans }}</li>
            <li>This draft was never activated — deleting it does not affect any live scores.</li>
            <li>ACTIVE and ARCHIVED models can never be deleted from this page.</li>
          </ul>
          <StatusBanner v-if="deleteError" tone="error" data-testid="delete-conflict-error">
            {{ deleteError }}
            <ul v-if="deleteConflictCounts" data-testid="delete-conflict-counts">
              <li v-if="deleteConflictCounts.scoreSnapshots">Score snapshots: {{ deleteConflictCounts.scoreSnapshots }}</li>
              <li v-if="deleteConflictCounts.characterRedFlags">Character red flags: {{ deleteConflictCounts.characterRedFlags }}</li>
              <li v-if="deleteConflictCounts.addonExports">Addon exports: {{ deleteConflictCounts.addonExports }}</li>
              <li v-if="deleteConflictCounts.analysisBatches">Analysis batches: {{ deleteConflictCounts.analysisBatches }}</li>
              <li v-if="deleteConflictCounts.bulkOperations">Bulk operations: {{ deleteConflictCounts.bulkOperations }}</li>
            </ul>
          </StatusBanner>
          <div class="actions">
            <button type="button" class="btn" :disabled="deleting" @click="cancelDelete">
              Cancel
            </button>
            <button
              type="button"
              class="btn danger"
              data-testid="confirm-delete-draft"
              :disabled="deleting"
              @click="confirmDelete"
            >
              {{ deleting ? "Deleting…" : "Delete draft permanently" }}
            </button>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.editor fieldset {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.6rem;
  margin: 1rem 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.85rem;
  background: var(--panel);
}

@media (min-width: 720px) {
  .editor fieldset {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .editor fieldset > legend {
    grid-column: 1 / -1;
  }
}

label {
  display: grid;
  gap: 0.25rem;
  font-weight: 600;
  min-width: 0;
}

.label-row {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  flex-wrap: wrap;
}

legend {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-weight: 700;
}

input {
  font: inherit;
  padding: 0.45rem 0.6rem;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--panel-2);
  color: var(--fg);
  min-width: 0;
}

.layout {
  display: grid;
  gap: 1.25rem;
  max-width: 100%;
}

@media (min-width: 900px) {
  .layout {
    grid-template-columns: minmax(20rem, 34rem) minmax(0, 1fr);
    align-items: start;
  }
}

.catalog {
  min-width: 0;
}

.catalog-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  align-items: end;
  margin: 0.5rem 0;
}

.catalog-search,
.catalog-status {
  display: grid;
  gap: 0.25rem;
  flex: 1 1 10rem;
  min-width: 8rem;
}

.catalog-reset {
  flex: 0 0 auto;
}

.catalog-count {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin: 0.35rem 0;
}

.catalog-hidden-note {
  margin: 0.35rem 0;
}

.catalog-table-scroll {
  max-height: 24rem;
  overflow-y: auto;
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
}

.catalog-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}

.catalog-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--panel-2);
  text-align: left;
  padding: 0.5rem 0.6rem;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}

.catalog-table td {
  padding: 0.45rem 0.6rem;
  border-bottom: 1px solid var(--border);
  vertical-align: middle;
}

.catalog-key {
  overflow-wrap: anywhere;
  max-width: 10rem;
}

.catalog-row {
  cursor: pointer;
}

.catalog-row:hover {
  background: var(--panel-2);
}

.catalog-row:focus-visible {
  outline: 2px solid var(--accent, var(--color-focus));
  outline-offset: -2px;
}

.catalog-row--selected {
  background: color-mix(in srgb, var(--accent, #f59e0b) 14%, transparent);
}

.catalog-empty {
  padding: 0.85rem;
  margin: 0;
}

.model-row {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  text-align: left;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
  margin: 1rem 0;
}

.muted {
  color: var(--muted);
}

.tiny {
  font-size: 0.85rem;
}

.error {
  color: var(--danger);
}

.validation ul {
  color: var(--danger);
}

.badge {
  display: inline-block;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  padding: 0.15rem 0.4rem;
  border-radius: 4px;
  border: 1px solid var(--border);
}

.status-active {
  background: color-mix(in srgb, var(--success, #2a7) 18%, transparent);
}

.status-draft {
  background: color-mix(in srgb, var(--warning, #c90) 18%, transparent);
}

.status-archived {
  opacity: 0.75;
}

.confirm,
.backtest,
.activation-result,
.readonly-meta {
  margin-top: 1rem;
  padding: 0.85rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
}

.readonly-meta p {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex-wrap: wrap;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
  margin-bottom: 1rem;
}

.btn.danger {
  background: var(--color-danger-500, #b91c1c);
  color: #fff;
  border-color: transparent;
}

.btn.danger.small {
  padding: 0.25rem 0.55rem;
  font-size: 0.8rem;
}

.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgb(0 0 0 / 55%);
  padding: 1rem;
}

.modal {
  max-width: 32rem;
  width: 100%;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 1.25rem;
}
</style>
