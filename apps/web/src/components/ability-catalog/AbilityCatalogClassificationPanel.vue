<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { DRAFT_ABILITY_CATEGORIES } from "@mplus/abilities";
import { api } from "../../api/client";
import type { AbilityCatalogReviewItemSummary } from "../../api/types";
import { loadWowheadTooltipScript, refreshWowheadTooltips } from "../../integrations/wowhead/tooltips";
import { wowheadSpellUrl } from "../../integrations/wowhead/urls";
import AppToast from "../common/AppToast.vue";
import SpellWowIcon from "./SpellWowIcon.vue";

const emit = defineEmits<{
  changed: [];
}>();

const loading = ref(false);
const saving = ref(false);
const error = ref<string | null>(null);
const batchId = ref<string | null>(null);
const items = ref<AbilityCatalogReviewItemSummary[]>([]);
const selectedId = ref<string | null>(null);
const modalOpen = ref(false);
const category = ref("");
const includeErrorToast = ref<string | null>(null);

const categoryOptions = DRAFT_ABILITY_CATEGORIES.map((value) => ({ value, label: value }));

function formatAvailabilityLabel(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "Unknown source availability";
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

const sourceAvailabilityLabel = computed(() =>
  formatAvailabilityLabel(selectedItem.value?.draftRule?.availability),
);

const canInclude = computed(
  () => Boolean(category.value && selectedItem.value && !saving.value),
);

const selectedItem = computed(
  () => items.value.find((item) => item.id === selectedId.value) ?? null,
);

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const { batches } = await api.listAbilityCatalogReviewBatches();
    const open = batches.find((batch) => batch.status === "OPEN") ?? batches[0] ?? null;
    batchId.value = open?.id ?? null;
    if (!open) {
      items.value = [];
      closeModal();
      return;
    }
    const result = await api.listAbilityCatalogReviewItems(open.id, {
      kind: "NEW_ABILITY_CANDIDATE",
      decisionState: "pending",
    });
    items.value = (result.items ?? []).filter(
      (item) => item.mplusRelevance === "UNCLASSIFIED" || item.mplusRelevance == null,
    );
    if (modalOpen.value && !items.value.some((item) => item.id === selectedId.value)) {
      closeModal();
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to load candidates";
  } finally {
    loading.value = false;
  }
}

function selectItem(item: AbilityCatalogReviewItemSummary): void {
  selectedId.value = item.id;
  category.value = String(item.draftRule?.category ?? "");
  modalOpen.value = true;
}

function closeModal(): void {
  modalOpen.value = false;
  selectedId.value = null;
  category.value = "";
}

async function refreshTooltips(): Promise<void> {
  await nextTick();
  refreshWowheadTooltips();
}

watch(modalOpen, (open) => {
  if (!open) return;
  void loadWowheadTooltipScript()
    .then((status) => {
      if (status === "ready") return refreshTooltips();
    })
    .catch(() => {
      /* progressive enhancement */
    });
});

async function includeSelected(): Promise<void> {
  const item = selectedItem.value;
  if (!item || !canInclude.value) return;
  saving.value = true;
  error.value = null;
  includeErrorToast.value = null;
  try {
    await api.decideAbilityCatalogReviewItem(item.id, {
      expectedVersion: item.version,
      action: "ACCEPT",
      businessMetadata: {
        category: category.value,
      },
    });
    emit("changed");
    closeModal();
    await load();
  } catch (err) {
    includeErrorToast.value = err instanceof Error ? err.message : "Failed to include ability";
  } finally {
    saving.value = false;
  }
}

async function excludeSelected(): Promise<void> {
  const item = selectedItem.value;
  if (!item || saving.value) return;
  saving.value = true;
  error.value = null;
  try {
    await api.decideAbilityCatalogReviewItem(item.id, {
      expectedVersion: item.version,
      action: "EXCLUDE",
    });
    emit("changed");
    closeModal();
    await load();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to exclude ability";
  } finally {
    saving.value = false;
  }
}

async function deferSelected(): Promise<void> {
  const item = selectedItem.value;
  if (!item || saving.value) return;
  saving.value = true;
  error.value = null;
  try {
    await api.decideAbilityCatalogReviewItem(item.id, {
      expectedVersion: item.version,
      action: "DEFER",
    });
    emit("changed");
    closeModal();
    await load();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to defer ability";
  } finally {
    saving.value = false;
  }
}

onMounted(() => {
  void load();
});

defineExpose({ reload: load });
</script>

<template>
  <section class="classify-panel" data-testid="catalog-classify-panel">
    <p v-if="loading" class="muted">Loading candidates…</p>
    <p v-else-if="!batchId" class="muted">No review batch yet. Source sync will populate candidates.</p>
    <p v-else-if="items.length === 0" class="muted">No abilities need classification.</p>
    <template v-else>
      <ul class="classify-list">
        <li v-for="item in items" :key="item.id">
          <button type="button" class="classify-item" @click="selectItem(item)">
            <SpellWowIcon
              v-if="item.primarySpellId"
              :spell-id="item.primarySpellId"
              :alt="item.name"
              :width="24"
              :height="24"
            />
            <span>
              <strong>{{ item.name }}</strong>
              <span v-if="item.primarySpellId" class="muted"> · {{ item.primarySpellId }}</span>
            </span>
          </button>
        </li>
      </ul>
    </template>

    <div
      v-if="modalOpen && selectedItem"
      class="classify-modal-overlay"
      data-testid="classify-modal"
      @click.self="closeModal"
    >
      <div
        class="classify-modal-dialog"
        role="dialog"
        aria-modal="true"
        :aria-label="`Classify ${selectedItem.name}`"
      >
        <header class="classify-modal-header">
          <a
            v-if="selectedItem.primarySpellId && wowheadSpellUrl(selectedItem.primarySpellId)"
            class="classify-modal-header__icon-link"
            :href="wowheadSpellUrl(selectedItem.primarySpellId)!"
            target="_blank"
            rel="noopener noreferrer"
            :data-wowhead="`spell=${selectedItem.primarySpellId}`"
            :aria-label="`${selectedItem.name} on Wowhead`"
            data-testid="classify-icon-tooltip"
          >
            <SpellWowIcon
              :spell-id="selectedItem.primarySpellId"
              :alt="selectedItem.name"
              :width="44"
              :height="44"
            />
          </a>
          <SpellWowIcon
            v-else-if="selectedItem.primarySpellId"
            class="classify-modal-header__icon-static"
            :spell-id="selectedItem.primarySpellId"
            :alt="selectedItem.name"
            :width="44"
            :height="44"
          />
          <div class="classify-modal-header__text">
            <h3 class="classify-modal-title">{{ selectedItem.name }}</h3>
            <p class="muted">
              Spell {{ selectedItem.primarySpellId ?? "—" }} · {{ selectedItem.classSlug ?? "—" }}
            </p>
          </div>
        </header>

        <div class="classify-form">
          <label>
            Category
            <select v-model="category" class="admin-control" data-testid="classify-category">
              <option value="">Select category</option>
              <option v-for="opt in categoryOptions" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </option>
            </select>
          </label>
          <div class="source-availability" data-testid="classify-availability">
            <span class="source-availability__label">Availability</span>
            <span class="source-availability__value">{{ sourceAvailabilityLabel }}</span>
          </div>
        </div>

        <div class="classify-actions">
          <button type="button" class="btn secondary" :disabled="saving" @click="closeModal">
            Cancel
          </button>
          <button type="button" class="btn primary" :disabled="!canInclude" @click="includeSelected">
            Include
          </button>
          <button type="button" class="btn danger" :disabled="saving" @click="excludeSelected">
            Exclude
          </button>
          <button type="button" class="btn secondary" :disabled="saving" @click="deferSelected">
            Defer
          </button>
        </div>
      </div>
    </div>
    <p v-if="error" class="error">{{ error }}</p>

    <AppToast
      :open="Boolean(includeErrorToast)"
      :message="includeErrorToast ?? ''"
      tone="error"
      @close="includeErrorToast = null"
    />
  </section>
</template>

<style scoped>
.classify-panel {
  display: grid;
  gap: 0.85rem;
}

.classify-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.35rem;
}

.classify-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.55rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  background: var(--color-surface);
  padding: 0.45rem 0.6rem;
  cursor: pointer;
  text-align: left;
}

.classify-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem 1rem;
  background: color-mix(in srgb, var(--bg) 35%, transparent);
  backdrop-filter: blur(2px);
}

.classify-modal-dialog {
  width: min(480px, 100%);
  max-height: calc(100vh - 4rem);
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--panel);
  padding: 1rem 1.25rem;
  box-shadow: 0 12px 40px color-mix(in srgb, var(--fg) 12%, transparent);
}

.classify-modal-header {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  padding-bottom: 0.85rem;
  border-bottom: 1px solid var(--border);
}

.classify-modal-header__icon-link {
  display: inline-flex;
  flex-shrink: 0;
  border-radius: 6px;
  line-height: 0;
  text-decoration: none;
}

.classify-modal-header__icon-link:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.classify-modal-header__icon-static {
  flex-shrink: 0;
}

.classify-modal-header__text {
  min-width: 0;
}

.classify-modal-title {
  margin: 0;
  font-size: 1.15rem;
  line-height: 1.25;
}

.classify-form {
  display: grid;
  gap: 0.65rem;
  margin: 0.85rem 0;
}

.classify-form label {
  display: grid;
  gap: 0.25rem;
  font-size: 0.85rem;
}

.source-availability {
  display: grid;
  gap: 0.25rem;
  font-size: 0.85rem;
}

.source-availability__label {
  color: var(--color-text-muted, var(--muted));
}

.source-availability__value {
  font-weight: 500;
}

.classify-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  justify-content: flex-end;
}

.error {
  color: var(--color-danger, #c44);
  margin: 0;
}

.muted {
  color: var(--color-text-muted, var(--muted));
}
</style>
