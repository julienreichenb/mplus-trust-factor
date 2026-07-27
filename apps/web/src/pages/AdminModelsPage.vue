<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api } from "../api/client";
import type { AdminScoreModelDTO, BacktestSummary, EditableModelConfig, ModelValidationResult } from "../api/types";
import { DEFAULT_MODEL_CONFIG } from "../api/mock/fixtures";
import { validateModelConfig } from "../api/mock/client";
import { deepClone } from "../lib/clone";
import StatusBanner from "../components/common/StatusBanner.vue";

const unlocked = ref(import.meta.env.VITE_API_MODE !== "live");
const adminKeyInput = ref("");
const models = ref<AdminScoreModelDTO[]>([]);
const selectedId = ref<string | null>(null);
const draftConfig = ref<EditableModelConfig>(deepClone(DEFAULT_MODEL_CONFIG));
const validation = ref<ModelValidationResult | null>(null);
const backtest = ref<BacktestSummary | null>(null);
const message = ref<string | null>(null);
const error = ref<string | null>(null);
const busy = ref(false);

const selected = computed(() => models.value.find((m) => m.id === selectedId.value) ?? null);
const isDraft = computed(() => selected.value?.status === "DRAFT");

function unlock(): void {
  if (adminKeyInput.value.trim().length >= 8) {
    unlocked.value = true;
  } else {
    error.value = "Enter a valid admin key (mock accepts any 8+ chars).";
  }
}

async function loadModels(): Promise<void> {
  models.value = await api.listModels();
  if (!selectedId.value && models.value[0]) {
    selectModel(models.value[0].id);
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
  message.value = null;
  error.value = null;
}

async function cloneActive(): Promise<void> {
  const active = models.value.find((m) => m.status === "ACTIVE");
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
    message.value = `Cloned draft ${draft.name}`;
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    busy.value = false;
  }
}

function runLocalValidate(): void {
  validation.value = validateModelConfig(draftConfig.value);
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
    error.value = (err as Error).message;
  } finally {
    busy.value = false;
  }
}

async function runBacktest(): Promise<void> {
  if (!selected.value) return;
  busy.value = true;
  try {
    backtest.value = await api.backtestModel(selected.value.id);
    message.value = "Fixture backtest complete.";
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    busy.value = false;
  }
}

async function activate(): Promise<void> {
  if (!selected.value || !isDraft.value) return;
  runLocalValidate();
  if (!validation.value?.valid) {
    error.value = "Cannot activate invalid weights.";
    return;
  }
  const ok = window.confirm(
    `Activate ${selected.value.name}? This archives the current active version.`,
  );
  if (!ok) return;
  busy.value = true;
  try {
    await api.updateModel(selected.value.id, draftConfig.value);
    await api.activateModel(selected.value.id);
    await loadModels();
    message.value = "Model activated.";
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    busy.value = false;
  }
}

onMounted(() => {
  if (unlocked.value) void loadModels();
});
</script>

<template>
  <section data-testid="admin-page">
    <h1>Admin score models</h1>
    <p>Draft, validate, backtest, and activate immutable model versions. No scoring math runs in the browser.</p>

    <div v-if="!unlocked" class="gate" data-testid="admin-gate">
      <label>
        Admin API key
        <input v-model="adminKeyInput" type="password" autocomplete="off" data-testid="admin-key" />
      </label>
      <button type="button" class="btn primary" @click="unlock">Unlock</button>
      <p v-if="error" class="error">{{ error }}</p>
    </div>

    <template v-else>
      <StatusBanner v-if="message" tone="success">{{ message }}</StatusBanner>
      <StatusBanner v-if="error" tone="error">{{ error }}</StatusBanner>

      <div class="toolbar">
        <button type="button" class="btn" data-testid="clone-model" :disabled="busy" @click="cloneActive">
          Clone active → draft
        </button>
      </div>

      <div class="layout">
        <aside>
          <h2>Versions</h2>
          <ul class="model-list" data-testid="model-list">
            <li v-for="m in models" :key="m.id">
              <button
                type="button"
                class="btn link"
                :aria-current="m.id === selectedId ? 'true' : undefined"
                @click="selectModel(m.id)"
              >
                v{{ m.version }} · {{ m.status }} · {{ m.name }}
              </button>
            </li>
          </ul>
        </aside>

        <div v-if="selected" class="editor">
          <h2>{{ selected.name }}</h2>
          <p class="muted">Status: {{ selected.status }} · key {{ selected.key }}</p>

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
              Validate
            </button>
            <button type="button" class="btn" :disabled="!isDraft || busy" @click="saveDraft">Save draft</button>
            <button type="button" class="btn" data-testid="backtest-model" :disabled="busy" @click="runBacktest">
              Fixture backtest
            </button>
            <button
              type="button"
              class="btn primary"
              data-testid="activate-model"
              :disabled="!isDraft || busy"
              @click="activate"
            >
              Activate
            </button>
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
            <h3>Backtest</h3>
            <p>Cohort {{ backtest.cohortSize }} · mean {{ backtest.meanOverall }}</p>
            <p>{{ backtest.notes }}</p>
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
.gate,
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

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 1rem 0;
}

.muted {
  color: var(--muted);
}

.error {
  color: var(--danger);
}

.validation ul {
  color: var(--danger);
}
</style>
