<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { DRAFT_ABILITY_CATEGORIES, DRAFT_AVAILABILITIES } from "@mplus/abilities";
import { api } from "../../api/client";
import type { AbilityCatalogReviewItemSummary } from "../../api/types";
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
const category = ref("");
const availability = ref("");

const categoryOptions = DRAFT_ABILITY_CATEGORIES.map((value) => ({ value, label: value }));
const availabilityOptions = DRAFT_AVAILABILITIES.map((value) => ({ value, label: value }));

const selectedItem = computed(
  () => items.value.find((item) => item.id === selectedId.value) ?? null,
);

const canInclude = computed(
  () => Boolean(category.value && availability.value && selectedItem.value && !saving.value),
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
      selectedId.value = null;
      return;
    }
    const result = await api.listAbilityCatalogReviewItems(open.id, {
      kind: "NEW_ABILITY_CANDIDATE",
      decisionState: "pending",
    });
    items.value = (result.items ?? []).filter(
      (item) => item.mplusRelevance === "UNCLASSIFIED" || item.mplusRelevance == null,
    );
    if (!selectedId.value && items.value[0]) selectedId.value = items.value[0]!.id;
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to load candidates";
  } finally {
    loading.value = false;
  }
}

function selectItem(item: AbilityCatalogReviewItemSummary): void {
  selectedId.value = item.id;
  category.value = String(item.draftRule?.category ?? "");
  availability.value = String(item.draftRule?.availability ?? "");
}

async function includeSelected(): Promise<void> {
  const item = selectedItem.value;
  if (!item || !canInclude.value) return;
  saving.value = true;
  error.value = null;
  try {
    await api.decideAbilityCatalogReviewItem(item.id, {
      expectedVersion: item.version,
      action: "ACCEPT",
      businessMetadata: {
        category: category.value,
        availability: availability.value,
      },
    });
    emit("changed");
    await load();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to include ability";
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
          <button
            type="button"
            class="classify-item"
            :class="{ 'classify-item--active': item.id === selectedId }"
            @click="selectItem(item)"
          >
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

      <div v-if="selectedItem" class="classify-detail">
        <h3>{{ selectedItem.name }}</h3>
        <p class="muted">
          Spell {{ selectedItem.primarySpellId ?? "—" }} · {{ selectedItem.classSlug ?? "—" }}
        </p>
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
          <label>
            Availability
            <select v-model="availability" class="admin-control" data-testid="classify-availability">
              <option value="">Select availability</option>
              <option v-for="opt in availabilityOptions" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </option>
            </select>
          </label>
        </div>
        <div class="classify-actions">
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
    </template>
    <p v-if="error" class="error">{{ error }}</p>
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

.classify-item--active {
  border-color: var(--color-accent, var(--accent));
}

.classify-detail {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  padding: 0.75rem;
  background: var(--color-surface);
}

.classify-form {
  display: grid;
  gap: 0.65rem;
  margin: 0.75rem 0;
}

.classify-form label {
  display: grid;
  gap: 0.25rem;
  font-size: 0.85rem;
}

.classify-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.error {
  color: var(--color-danger, #c44);
  margin: 0;
}

.muted {
  color: var(--color-text-muted, var(--muted));
}
</style>
