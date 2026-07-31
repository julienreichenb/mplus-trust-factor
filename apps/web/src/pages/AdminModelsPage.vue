<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { api } from "../api/client";
import type {
  ActivateScoreModelResult,
  AdminScoreModelDTO,
  BacktestSummary,
  EditableModelConfig,
  ModelValidationResult,
} from "../api/types";
import { DEFAULT_MODEL_CONFIG } from "../api/mock/fixtures";
import { validateModelConfig } from "../api/mock/client";
import { deepClone } from "../lib/clone";
import StatusBanner from "../components/common/StatusBanner.vue";
import { ApiClientError } from "../api/live-client";

const router = useRouter();
const models = ref<AdminScoreModelDTO[]>([]);
const selectedId = ref<string | null>(null);
const draftConfig = ref<EditableModelConfig>(deepClone(DEFAULT_MODEL_CONFIG));
const validation = ref<ModelValidationResult | null>(null);
const backtest = ref<BacktestSummary | null>(null);
const activationResult = ref<ActivateScoreModelResult | null>(null);
const message = ref<string | null>(null);
const error = ref<string | null>(null);
const busy = ref(false);
const ready = ref(false);
const showActivateConfirm = ref(false);
const activating = ref(false);

const selected = computed(() => models.value.find((m) => m.id === selectedId.value) ?? null);
const isDraft = computed(() => selected.value?.status === "DRAFT");
const activeModel = computed(() => models.value.find((m) => m.status === "ACTIVE") ?? null);
const archivedModels = computed(() => models.value.filter((m) => m.status === "ARCHIVED"));

const weightSum = computed(() => {
  const w = draftConfig.value.weights;
  return (
    w.performance +
    w.survival +
    w.utility +
    w.experienceConsistency +
    w.mythicRaid
  );
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

async function loadModels(): Promise<void> {
  models.value = await api.listModels();
  if (!selectedId.value && models.value[0]) {
    selectModel(models.value[0].id);
  } else if (selectedId.value) {
    const still = models.value.find((m) => m.id === selectedId.value);
    if (!still && models.value[0]) selectModel(models.value[0].id);
  }
}

function selectModel(id: string): void {
  selectedId.value = id;
  const model = models.value.find((m) => m.id === id);
  draftConfig.value = deepClone(
    (model?.config as EditableModelConfig | undefined) ?? DEFAULT_MODEL_CONFIG,
  );
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
  validation.value = validateModelConfig(draftConfig.value);
}

async function runServerValidate(): Promise<void> {
  if (!selected.value) return;
  busy.value = true;
  error.value = null;
  try {
    if (isDraft.value) {
      await api.updateModel(selected.value.id, draftConfig.value);
    }
    const result = await api.validateModel(selected.value.id, draftConfig.value);
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
  runLocalValidate();
  if (!validation.value?.valid) {
    error.value = "Fix validation errors before saving.";
    return;
  }
  busy.value = true;
  try {
    await api.updateModel(selected.value.id, draftConfig.value);
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
  busy.value = true;
  error.value = null;
  try {
    if (isDraft.value) {
      await api.updateModel(selected.value.id, draftConfig.value);
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
  activating.value = true;
  busy.value = true;
  error.value = null;
  try {
    await api.updateModel(selected.value.id, draftConfig.value);
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
      ready.value = true;
    })
    .catch((err) => {
      if (!handleAuthError(err)) {
        error.value = (err as Error).message;
        ready.value = true;
      }
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

    <template v-if="ready">
      <StatusBanner v-if="message" tone="success">{{ message }}</StatusBanner>
      <StatusBanner v-if="error" tone="error">{{ error }}</StatusBanner>

      <div class="toolbar">
        <button type="button" class="btn" data-testid="clone-model" :disabled="busy" @click="cloneActive">
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

        <div v-if="selected" class="editor">
          <h2>{{ selected.name }}</h2>
          <p class="muted">
            <span class="badge" :class="statusClass(selected.status)">{{ selected.status }}</span>
            · key {{ selected.key }} · version {{ selected.version }}
            <template v-if="selected.activatedAt"> · activated {{ selected.activatedAt }}</template>
          </p>
          <p v-if="!isDraft" class="muted">This version is immutable. Clone the active model to edit.</p>

          <fieldset :disabled="!isDraft">
            <legend>Dimension weights</legend>
            <label>
              performance
              <input
                v-model.number="draftConfig.weights.performance"
                type="number"
                step="0.01"
                min="0"
                max="1"
                data-testid="weight-performance"
              />
            </label>
            <label>
              survival
              <input v-model.number="draftConfig.weights.survival" type="number" step="0.01" min="0" max="1" />
            </label>
            <label>
              utility
              <input v-model.number="draftConfig.weights.utility" type="number" step="0.01" min="0" max="1" />
            </label>
            <label>
              experienceConsistency
              <input
                v-model.number="draftConfig.weights.experienceConsistency"
                type="number"
                step="0.01"
                min="0"
                max="1"
              />
            </label>
            <label>
              mythicRaid
              <input v-model.number="draftConfig.weights.mythicRaid" type="number" step="0.01" min="0" max="1" />
            </label>
          </fieldset>

          <fieldset :disabled="!isDraft">
            <legend>Nested metric weights (performance)</legend>
            <label v-for="(_val, key) in draftConfig.nestedMetricWeights.performance" :key="key">
              {{ key }}
              <input
                v-model.number="draftConfig.nestedMetricWeights.performance[key]"
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
              <input v-model.number="draftConfig.gradeThresholds.S" type="number" step="1" min="0" max="100" />
            </label>
            <label>
              A
              <input v-model.number="draftConfig.gradeThresholds.A" type="number" step="1" min="0" max="100" />
            </label>
            <label>
              B
              <input v-model.number="draftConfig.gradeThresholds.B" type="number" step="1" min="0" max="100" />
            </label>
            <label>
              C
              <input v-model.number="draftConfig.gradeThresholds.C" type="number" step="1" min="0" max="100" />
            </label>
          </fieldset>

          <fieldset :disabled="!isDraft">
            <legend>Confidence parameters</legend>
            <label>
              Min runs for full confidence
              <input
                v-model.number="draftConfig.confidenceParameters.minRunsForFullConfidence"
                type="number"
                min="1"
              />
            </label>
            <label>
              Shrinkage floor
              <input
                v-model.number="draftConfig.confidenceParameters.shrinkageFloor"
                type="number"
                step="0.01"
                min="0"
                max="1"
              />
            </label>
          </fieldset>

          <fieldset :disabled="!isDraft">
            <legend>Boost thresholds (suspicion)</legend>
            <label>
              Soft
              <input
                v-model.number="draftConfig.boostThresholds.suspicionSoft"
                type="number"
                step="0.01"
                min="0"
                max="1"
                data-testid="boost-soft"
              />
            </label>
            <label>
              Hard
              <input
                v-model.number="draftConfig.boostThresholds.suspicionHard"
                type="number"
                step="0.01"
                min="0"
                max="1"
              />
            </label>
          </fieldset>

          <div class="actions">
            <button type="button" class="btn" data-testid="validate-model" @click="runLocalValidate">
              Validate local
            </button>
            <button type="button" class="btn" data-testid="server-validate-model" :disabled="busy" @click="runServerValidate">
              Server validate
            </button>
            <button type="button" class="btn" :disabled="!isDraft || busy" @click="saveDraft">Save draft</button>
            <button type="button" class="btn" data-testid="backtest-model" :disabled="busy" @click="runBacktest">
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
            <template v-if="backtest.outliers?.length">
              <h4>Outliers</h4>
              <ul>
                <li v-for="(o, idx) in backtest.outliers.slice(0, 8)" :key="idx">
                  {{ typeof o === "object" ? JSON.stringify(o) : o }}
                </li>
              </ul>
            </template>
            <template v-if="backtest.confidenceVersusCoverage?.length">
              <h4>Confidence / coverage</h4>
              <p class="muted">{{ backtest.confidenceVersusCoverage.length }} points</p>
            </template>
            <template v-if="backtest.activeDraftComparison">
              <h4>Draft vs active</h4>
              <p>{{ backtest.activeDraftComparison.note }}</p>
              <p v-if="backtest.activeDraftComparison.aggregate">
                Comparable {{ backtest.activeDraftComparison.aggregate.comparableCount }} ·
                mean Δ overall
                {{
                  backtest.activeDraftComparison.aggregate.meanScoreDelta?.toFixed?.(3) ??
                  backtest.activeDraftComparison.aggregate.meanScoreDelta
                }}
              </p>
            </template>
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
.activation-result {
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
