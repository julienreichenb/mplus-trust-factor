<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { api } from "../api/client";
import type {
  ActivateScoreModelResult,
  AdminScoreModelDTO,
  BacktestSummary,
  ModelValidationResult,
} from "../api/types";
import {
  METRIC_WEIGHT_DIMENSIONS,
  parsePersistedModelConfig,
  toPersistedConfig,
  validateModelConfigForm,
  type ModelConfigFormState,
} from "../api/model-config";
import { deepClone } from "../lib/clone";
import StatusBanner from "../components/common/StatusBanner.vue";
import { ApiClientError } from "../api/live-client";

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

const selected = computed(() => models.value.find((m) => m.id === selectedId.value) ?? null);
const isDraft = computed(() => selected.value?.status === "DRAFT");
const activeModel = computed(() => models.value.find((m) => m.status === "ACTIVE") ?? null);
const archivedModels = computed(() => models.value.filter((m) => m.status === "ARCHIVED"));
const configEditable = computed(() => draftForm.value !== null && draftBase.value !== null);
const isEmptyCatalog = computed(() => !loading.value && !loadError.value && models.value.length === 0);

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

async function loadModels(): Promise<void> {
  models.value = await api.listModels();
  if (!selectedId.value && models.value[0]) {
    selectModel(models.value[0].id);
  } else if (selectedId.value) {
    const still = models.value.find((m) => m.id === selectedId.value);
    if (!still && models.value[0]) selectModel(models.value[0].id);
    else if (still) selectModel(still.id);
  }
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
      <StatusBanner v-if="message" tone="success">{{ message }}</StatusBanner>
      <StatusBanner v-if="error" tone="error">{{ error }}</StatusBanner>

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
        <RouterLink class="btn link" to="/admin/bulk-processing">Bulk processing</RouterLink>
      </div>

      <div class="layout">
        <aside>
          <h2>Version history</h2>
          <ul class="model-list" data-testid="model-list">
            <li v-for="m in models" :key="m.id">
              <button
                type="button"
                class="btn link model-row"
                :aria-current="m.id === selectedId ? 'true' : undefined"
                @click="selectModel(m.id)"
              >
                <span class="badge" :class="statusClass(m.status)">{{ m.status }}</span>
                <span>v{{ m.version }} · {{ m.name }}</span>
              </button>
            </li>
          </ul>
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
              <legend>Dimension weights</legend>
              <label>
                performance
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
                survival
                <input
                  v-model.number="draftForm.weights.survival"
                  type="number"
                  step="0.01"
                  min="0"
                  max="1"
                />
              </label>
              <label>
                utility
                <input
                  v-model.number="draftForm.weights.utility"
                  type="number"
                  step="0.01"
                  min="0"
                  max="1"
                />
              </label>
              <label>
                experienceConsistency
                <input
                  v-model.number="draftForm.weights.experienceConsistency"
                  type="number"
                  step="0.01"
                  min="0"
                  max="1"
                />
              </label>
              <label>
                mythicRaid
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
              <legend>Metric weights ({{ dim }})</legend>
              <label v-for="(entry, idx) in draftForm.metricWeights[dim]" :key="`${dim}-${entry.metricKey}-${idx}`">
                {{ entry.metricKey }}
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
              <legend>Grade thresholds</legend>
              <label>
                S
                <input v-model.number="draftForm.gradeThresholds.S" type="number" step="1" min="0" max="100" />
              </label>
              <label>
                A
                <input v-model.number="draftForm.gradeThresholds.A" type="number" step="1" min="0" max="100" />
              </label>
              <label>
                B
                <input v-model.number="draftForm.gradeThresholds.B" type="number" step="1" min="0" max="100" />
              </label>
              <label>
                C
                <input v-model.number="draftForm.gradeThresholds.C" type="number" step="1" min="0" max="100" />
              </label>
            </fieldset>

            <fieldset v-if="draftForm.minConfidenceForGrade !== null" :disabled="!isDraft">
              <legend>Confidence for grade</legend>
              <label>
                minConfidenceForGrade
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
              <legend>Authenticity blend</legend>
              <label>
                skillWeight
                <input
                  v-model.number="draftForm.authenticityBlend.skillWeight"
                  type="number"
                  step="0.01"
                  min="0"
                  max="1"
                />
              </label>
              <label>
                authenticityWeight
                <input
                  v-model.number="draftForm.authenticityBlend.authenticityWeight"
                  type="number"
                  step="0.01"
                  min="0"
                  max="1"
                />
              </label>
              <label>
                confidenceNeutralScore
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
              <legend>Authenticity tags (persisted)</legend>
              <label>
                boostSuspectedBelow
                <input
                  v-model.number="draftForm.authenticityTags.boostSuspectedBelow"
                  type="number"
                  step="1"
                  data-testid="boost-soft"
                />
              </label>
              <label>
                atypicalBelow
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
              </p>
              <p v-if="readOnlyUtilityEligibility" class="muted tiny">
                utilityPublicationEligibility:
                <code>{{ JSON.stringify(readOnlyUtilityEligibility) }}</code>
              </p>
              <p v-if="readOnlyEligibility" class="muted tiny">
                eligibility: <code>{{ JSON.stringify(readOnlyEligibility) }}</code>
              </p>
            </div>

            <div class="actions">
              <button type="button" class="btn" data-testid="validate-model" @click="runLocalValidate">
                Validate local
              </button>
              <button
                type="button"
                class="btn"
                data-testid="server-validate-model"
                :disabled="busy"
                @click="runServerValidate"
              >
                Server validate
              </button>
              <button type="button" class="btn" :disabled="!isDraft || busy" @click="saveDraft">
                Save draft
              </button>
              <button
                type="button"
                class="btn"
                data-testid="backtest-model"
                :disabled="busy"
                @click="runBacktest"
              >
                Cohort backtest
              </button>
              <button
                type="button"
                class="btn primary"
                data-testid="activate-model"
                :disabled="!isDraft || busy || activating"
                @click="openActivateConfirm"
              >
                Activate…
              </button>
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
    </template>
  </section>
</template>

<style scoped>
.editor fieldset {
  display: grid;
  gap: 0.6rem;
  max-width: 28rem;
  margin: 1rem 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.85rem;
  background: var(--panel);
}

label {
  display: grid;
  gap: 0.25rem;
  font-weight: 600;
}

input {
  font: inherit;
  padding: 0.45rem 0.6rem;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--panel-2);
  color: var(--fg);
}

.layout {
  display: grid;
  gap: 1.25rem;
}

@media (min-width: 900px) {
  .layout {
    grid-template-columns: 16rem 1fr;
  }
}

.model-list {
  list-style: none;
  padding: 0;
  display: grid;
  gap: 0.35rem;
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

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
  margin-bottom: 1rem;
}
</style>
