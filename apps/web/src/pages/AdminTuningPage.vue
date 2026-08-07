<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../api/client";
import type { AdminScoreModelDTO } from "../api/types";
import {
  createDefaultTunableWeights,
  effectiveWeightPercent,
  formatEffectivePercent,
  mergeTunableWeightsIntoConfig,
  resolveTunableWeightsFromConfig,
  validateTunableWeightsClient,
  type TunableWeightsV1,
} from "../api/tunable-weights";
import StatusBanner from "../components/common/StatusBanner.vue";
import SkeletonBlock from "../components/common/SkeletonBlock.vue";
import FieldTooltip from "../components/common/FieldTooltip.vue";
import ModelStatusBadge from "../components/admin/ModelStatusBadge.vue";
import AdminSelect from "../components/admin/AdminSelect.vue";
import { COMPONENT_HELP, DIMENSION_HELP } from "./adminScoringHelp";

const props = withDefaults(
  defineProps<{
    embedded?: boolean;
  }>(),
  { embedded: false },
);

const route = useRoute();
const router = useRouter();

const models = ref<AdminScoreModelDTO[]>([]);
const selectedId = ref<string>("");
const draftWeights = ref<TunableWeightsV1>(createDefaultTunableWeights());
const savedSnapshot = ref<string>("");
const loading = ref(true);
const loadError = ref<string | null>(null);
const message = ref<string | null>(null);
const error = ref<string | null>(null);
const saving = ref(false);
const showActivateConfirm = ref(false);
const activating = ref(false);

const selected = computed(() => models.value.find((m) => m.id === selectedId.value) ?? null);
const isDraft = computed(() => selected.value?.status === "DRAFT");
const isEditable = computed(() => isDraft.value);
const isDirty = computed(() => JSON.stringify(draftWeights.value) !== savedSnapshot.value);
const validationErrors = computed(() => validateTunableWeightsClient(draftWeights.value));

const modelOptions = computed(() =>
  [...models.value]
    .sort((a, b) => {
      const rank = { ACTIVE: 0, DRAFT: 1, ARCHIVED: 2 } as const;
      const d = rank[a.status] - rank[b.status];
      if (d !== 0) return d;
      return b.version - a.version;
    })
    .map((m) => ({
      value: m.id,
      label: `${m.name} · v${m.version} · ${m.status}`,
    })),
);

const dimEffective = computed(() => {
  const d = draftWeights.value.dimensions;
  return {
    performance: effectiveWeightPercent(d.performance, d),
    survival: effectiveWeightPercent(d.survival, d),
    utility: effectiveWeightPercent(d.utility, d),
    experience: effectiveWeightPercent(d.experience, d),
  };
});

function loadWeightsFromModel(model: AdminScoreModelDTO | null): void {
  const weights = model
    ? resolveTunableWeightsFromConfig(model.config)
    : createDefaultTunableWeights();
  draftWeights.value = weights;
  savedSnapshot.value = JSON.stringify(weights);
}

function selectModel(id: string): void {
  selectedId.value = id;
  const model = models.value.find((m) => m.id === id) ?? null;
  loadWeightsFromModel(model);
  void router.replace({ query: { ...route.query, model: id || undefined } });
}

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  try {
    models.value = await api.listModels();
    const fromQuery = typeof route.query.model === "string" ? route.query.model : "";
    const preferred =
      models.value.find((m) => m.id === fromQuery) ??
      models.value.find((m) => m.status === "DRAFT") ??
      models.value.find((m) => m.status === "ACTIVE") ??
      models.value[0] ??
      null;
    selectedId.value = preferred?.id ?? "";
    loadWeightsFromModel(preferred);
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

async function save(): Promise<void> {
  if (!selected.value || !isEditable.value) return;
  if (validationErrors.value.length > 0) {
    error.value = validationErrors.value[0] ?? "Invalid weights";
    return;
  }
  saving.value = true;
  error.value = null;
  message.value = null;
  try {
    const config = mergeTunableWeightsIntoConfig(selected.value.config, draftWeights.value);
    const updated = await api.updateModel(selected.value.id, config);
    models.value = models.value.map((m) => (m.id === updated.id ? updated : m));
    loadWeightsFromModel(updated);
    message.value = "Weights saved.";
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    saving.value = false;
  }
}

async function duplicateActive(): Promise<void> {
  const active = models.value.find((m) => m.status === "ACTIVE");
  if (!active) return;
  try {
    const draft = await api.cloneModel(active.id);
    models.value = await api.listModels();
    selectModel(draft.id);
    message.value = `Duplicated production model as draft v${draft.version}.`;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

async function confirmActivate(): Promise<void> {
  if (!selected.value || selected.value.status !== "DRAFT") return;
  activating.value = true;
  error.value = null;
  try {
    const active = models.value.find((m) => m.status === "ACTIVE");
    await api.activateModel(selected.value.id, {
      confirm: true,
      expectedPreviousActiveId: active?.id ?? null,
    });
    models.value = await api.listModels();
    const refreshed = models.value.find((m) => m.id === selectedId.value) ?? null;
    loadWeightsFromModel(refreshed);
    message.value = "Model activated. Previous production model was archived.";
    showActivateConfirm.value = false;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    activating.value = false;
  }
}

function componentEffective(
  group: Record<string, number>,
  key: string,
): string {
  return formatEffectivePercent(effectiveWeightPercent(group[key] ?? 0, group));
}

watch(
  () => route.query.model,
  (next) => {
    if (typeof next === "string" && next && next !== selectedId.value) {
      if (models.value.some((m) => m.id === next)) selectModel(next);
    }
  },
);

onMounted(() => {
  void load();
});
</script>

<template>
  <main
    class="admin-page"
    :class="{ 'admin-page--embedded': props.embedded }"
    aria-labelledby="tuning-title"
    data-testid="admin-tuning-page"
  >
    <header v-if="!props.embedded" class="admin-page__header">
      <div>
        <p class="eyebrow">Scoring</p>
        <h1 id="tuning-title">Tuning</h1>
        <p class="lede">
          Adjust relative dimension and component weights. Formulas stay code-owned — you only set
          how much each signal contributes. Values are normalized to effective percentages.
        </p>
      </div>
      <RouterLink class="btn ghost" :to="{ name: 'admin-scoring', params: { tab: 'models' } }"
        >Back to Models</RouterLink
      >
    </header>

    <StatusBanner v-if="message" tone="success" data-testid="tuning-success">{{ message }}</StatusBanner>
    <StatusBanner v-if="error" tone="error" data-testid="tuning-error">{{ error }}</StatusBanner>
    <StatusBanner v-if="loadError" tone="error">{{ loadError }}</StatusBanner>

    <div v-if="loading" class="skeletons" data-testid="tuning-loading">
      <SkeletonBlock height="4rem" />
      <SkeletonBlock height="12rem" />
    </div>

    <template v-else-if="models.length === 0">
      <div class="empty" data-testid="tuning-empty">
        <h2>No models available</h2>
        <p>Create or seed a scoring model first.</p>
      </div>
    </template>

    <template v-else>
      <section class="toolbar panel" aria-label="Model selection">
        <AdminSelect
          :model-value="selectedId"
          label="Scoring model"
          :options="modelOptions"
          data-testid="tuning-model-select"
          @update:model-value="selectModel"
        />
        <div v-if="selected" class="selected-meta">
          <ModelStatusBadge
            :status="selected.status"
            :production="selected.status === 'ACTIVE'"
          />
          <div>
            <div class="selected-name">{{ selected.name }}</div>
            <div class="selected-version">Version {{ selected.version }}</div>
          </div>
          <div class="toolbar-actions">
            <button
              v-if="selected.status === 'ACTIVE'"
              type="button"
              class="btn primary"
              data-testid="tuning-duplicate"
              @click="duplicateActive"
            >
              Duplicate as Draft
            </button>
            <button
              v-if="selected.status === 'DRAFT'"
              type="button"
              class="btn ghost"
              data-testid="tuning-activate"
              @click="showActivateConfirm = true"
            >
              Activate
            </button>
            <button
              v-if="isEditable"
              type="button"
              class="btn primary"
              :disabled="saving || !isDirty || validationErrors.length > 0"
              data-testid="tuning-save"
              @click="save"
            >
              {{ saving ? "Saving…" : isDirty ? "Save changes" : "Saved" }}
            </button>
          </div>
        </div>
        <p v-if="!isEditable" class="readonly-note" data-testid="tuning-readonly">
          {{ selected?.status === "ACTIVE" ? "Production model is view-only. Duplicate as draft to tune." : "Archived models are view-only historical evidence." }}
        </p>
        <p v-else-if="isDirty" class="dirty-note" data-testid="tuning-dirty">Unsaved changes</p>
      </section>

      <div class="dimensions" data-testid="tuning-dimensions">
        <section
          v-for="dimKey in (['performance', 'utility', 'survival', 'experience'] as const)"
          :key="dimKey"
          class="dim-card panel"
          :data-testid="`dimension-card-${dimKey}`"
        >
          <header class="dim-card__header">
            <div>
              <h2>
                {{ DIMENSION_HELP[dimKey].title }}
                <FieldTooltip
                  :label="`${DIMENSION_HELP[dimKey].title} help`"
                  :what-it-means="DIMENSION_HELP[dimKey].whatItMeans"
                />
              </h2>
              <p>{{ DIMENSION_HELP[dimKey].summary }}</p>
            </div>
            <div class="weight-pair">
              <label>
                <span>Relative weight</span>
                <input
                  v-model.number="draftWeights.dimensions[dimKey]"
                  type="number"
                  min="0"
                  step="1"
                  :disabled="!isEditable"
                  :data-testid="`dim-weight-${dimKey}`"
                />
              </label>
              <div class="effective" :data-testid="`dim-effective-${dimKey}`">
                Effective
                <strong>{{ formatEffectivePercent(dimEffective[dimKey]) }}</strong>
              </div>
            </div>
          </header>

          <div class="components">
            <template v-if="dimKey === 'performance'">
              <div
                v-for="key in (['phase1', 'cooldown', 'dungeonPeak', 'dungeonFloor', 'dungeonConsistency', 'profileBestAverage', 'profileMedianAverage'] as const)"
                :key="key"
                class="component-row"
              >
                <label>
                  <span class="comp-label">
                    {{ COMPONENT_HELP.performance[key].label }}
                    <FieldTooltip
                      :label="`${COMPONENT_HELP.performance[key].label} help`"
                      :what-it-means="COMPONENT_HELP.performance[key].whatItMeans"
                    />
                  </span>
                  <input
                    v-model.number="draftWeights.components.performance[key]"
                    type="number"
                    min="0"
                    step="1"
                    :disabled="!isEditable"
                    :data-testid="`comp-performance-${key}`"
                  />
                </label>
                <span class="comp-effective">{{
                  componentEffective(draftWeights.components.performance, key)
                }}</span>
              </div>
            </template>

            <template v-else-if="dimKey === 'utility'">
              <div
                v-for="key in (['castStops', 'support', 'strategicCc'] as const)"
                :key="key"
                class="component-row"
              >
                <label>
                  <span class="comp-label">
                    {{ COMPONENT_HELP.utility[key].label }}
                    <FieldTooltip
                      :label="`${COMPONENT_HELP.utility[key].label} help`"
                      :what-it-means="COMPONENT_HELP.utility[key].whatItMeans"
                    />
                  </span>
                  <input
                    v-model.number="draftWeights.components.utility[key]"
                    type="number"
                    min="0"
                    step="1"
                    :disabled="!isEditable"
                    :data-testid="`comp-utility-${key}`"
                  />
                </label>
                <span class="comp-effective">{{
                  componentEffective(draftWeights.components.utility, key)
                }}</span>
              </div>
            </template>

            <template v-else-if="dimKey === 'survival'">
              <div
                v-for="key in (['outcome', 'defensive', 'recovery'] as const)"
                :key="key"
                class="component-row"
              >
                <label>
                  <span class="comp-label">
                    {{ COMPONENT_HELP.survival[key].label }}
                    <FieldTooltip
                      :label="`${COMPONENT_HELP.survival[key].label} help`"
                      :what-it-means="COMPONENT_HELP.survival[key].whatItMeans"
                    />
                  </span>
                  <input
                    v-model.number="draftWeights.components.survival[key]"
                    type="number"
                    min="0"
                    step="1"
                    :disabled="!isEditable"
                    :data-testid="`comp-survival-${key}`"
                  />
                </label>
                <span class="comp-effective">{{
                  componentEffective(draftWeights.components.survival, key)
                }}</span>
              </div>
            </template>

            <template v-else>
              <p class="exp-note">
                Experience scoring ships later. These weights prepare the model structure — they do
                not produce Experience results yet.
              </p>
              <div
                v-for="key in (['previousSeasonScore', 'historicalTitle', 'historicalRanking'] as const)"
                :key="key"
                class="component-row"
              >
                <label>
                  <span class="comp-label">
                    {{ COMPONENT_HELP.experience[key].label }}
                    <FieldTooltip
                      :label="`${COMPONENT_HELP.experience[key].label} help`"
                      :what-it-means="COMPONENT_HELP.experience[key].whatItMeans"
                    />
                  </span>
                  <input
                    v-model.number="draftWeights.components.experience[key]"
                    type="number"
                    min="0"
                    step="1"
                    :disabled="!isEditable"
                    :data-testid="`comp-experience-${key}`"
                  />
                </label>
                <span class="comp-effective">{{
                  componentEffective(draftWeights.components.experience, key)
                }}</span>
              </div>
            </template>
          </div>
        </section>
      </div>
    </template>

    <div
      v-if="showActivateConfirm && selected"
      class="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tuning-activate-title"
      data-testid="tuning-activate-modal"
    >
      <div class="modal">
        <h2 id="tuning-activate-title">Activate this draft?</h2>
        <p>
          “{{ selected.name }}” v{{ selected.version }} becomes the production scoring model. The
          current active model is archived.
        </p>
        <div class="modal-actions">
          <button type="button" class="btn ghost" :disabled="activating" @click="showActivateConfirm = false">
            Cancel
          </button>
          <button
            type="button"
            class="btn primary"
            :disabled="activating"
            data-testid="tuning-confirm-activate"
            @click="confirmActivate"
          >
            {{ activating ? "Activating…" : "Confirm activation" }}
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
}

.lede {
  margin: var(--space-3) 0 0;
  max-width: 42rem;
  color: var(--color-text-muted);
  line-height: 1.5;
}

.panel {
  padding: var(--space-5);
  border-radius: var(--radius-card);
  border: 1px solid var(--color-border);
  background:
    linear-gradient(180deg, rgb(255 255 255 / 3%), transparent 45%),
    var(--color-surface);
}

.toolbar {
  display: grid;
  gap: var(--space-4);
}

.selected-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  align-items: center;
}

.selected-name {
  font-weight: 700;
}

.selected-version {
  font-family: var(--font-data);
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}

.toolbar-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-left: auto;
}

.readonly-note,
.dirty-note,
.exp-note {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

.dirty-note {
  color: var(--color-amber-400);
  font-weight: 600;
}

.dimensions {
  display: grid;
  gap: var(--space-5);
}

.dim-card__header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: var(--space-4);
  margin-bottom: var(--space-4);
  padding-bottom: var(--space-4);
  border-bottom: 1px solid var(--color-border);
}

.dim-card h2 {
  margin: 0;
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-xl);
}

.dim-card p {
  margin: var(--space-2) 0 0;
  color: var(--color-text-muted);
  max-width: 36rem;
  line-height: 1.45;
}

.weight-pair {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  align-items: end;
}

.weight-pair label,
.component-row label {
  display: grid;
  gap: var(--space-2);
  font-size: var(--text-sm);
}

.weight-pair input,
.component-row input {
  width: 6.5rem;
  padding: 0.55rem 0.65rem;
  border-radius: var(--radius-control);
  border: 1px solid var(--color-border);
  background: var(--color-bg-elevated);
  color: var(--color-text);
  font-family: var(--font-data);
  font-size: var(--text-sm);
}

.weight-pair input:focus-visible,
.component-row input:focus-visible {
  outline: none;
  border-color: var(--color-focus);
  box-shadow: 0 0 0 2px rgb(251 191 36 / 35%);
}

.weight-pair input:disabled,
.component-row input:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.effective,
.comp-effective {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

.effective strong,
.comp-effective {
  font-family: var(--font-data);
  color: var(--color-gold-300);
}

.components {
  display: grid;
  gap: var(--space-3);
}

.component-row {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-2) 0;
}

.comp-label {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-weight: 600;
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
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

.btn.primary {
  background: var(--color-brand);
  border-color: transparent;
  color: #111;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px rgb(251 191 36 / 40%);
}

.empty,
.skeletons {
  display: grid;
  gap: var(--space-3);
}

.empty {
  text-align: center;
  padding: var(--space-10);
  color: var(--color-text-muted);
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
}

.modal p {
  margin: 0;
  color: var(--color-text-muted);
}

.modal-actions {
  display: flex;
  gap: var(--space-2);
  justify-content: flex-end;
}

@media (max-width: 720px) {
  .toolbar-actions {
    margin-left: 0;
  }
}
</style>
