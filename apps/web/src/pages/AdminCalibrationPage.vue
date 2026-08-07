<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api } from "../api/client";
import type { AdminScoreModelDTO } from "../api/types";
import StatusBanner from "../components/common/StatusBanner.vue";
import SkeletonBlock from "../components/common/SkeletonBlock.vue";
import ModelStatusBadge from "../components/admin/ModelStatusBadge.vue";
import AdminSelect from "../components/admin/AdminSelect.vue";

/**
 * Calibration console shell.
 * Full cohort labeling / run / compare workflow ships in the next task.
 * Backend cohort APIs remain available; this page only prepares model selection
 * and the product navigation destination.
 */

const models = ref<AdminScoreModelDTO[]>([]);
const selectedId = ref("");
const loading = ref(true);
const loadError = ref<string | null>(null);

const selected = computed(() => models.value.find((m) => m.id === selectedId.value) ?? null);

const modelOptions = computed(() =>
  models.value
    .filter((m) => m.status === "ACTIVE" || m.status === "DRAFT")
    .sort((a, b) => {
      if (a.status === b.status) return b.version - a.version;
      return a.status === "ACTIVE" ? -1 : 1;
    })
    .map((m) => ({
      value: m.id,
      label: `${m.name} · v${m.version} · ${m.status}`,
    })),
);

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  try {
    models.value = await api.listModels();
    const preferred =
      models.value.find((m) => m.status === "ACTIVE") ??
      models.value.find((m) => m.status === "DRAFT") ??
      null;
    selectedId.value = preferred?.id ?? "";
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void load();
});
</script>

<template>
  <main class="admin-page" aria-labelledby="calibration-title" data-testid="admin-calibration-page">
    <header class="admin-page__header">
      <div>
        <p class="eyebrow">Scoring</p>
        <h1 id="calibration-title">Calibration</h1>
        <p class="lede">
          Compare expected player ranks against calculated Trust Scores for a labeled cohort.
          Choose an ACTIVE or DRAFT model — cohort labeling and runs land in the next release.
        </p>
      </div>
      <div class="header-actions">
        <RouterLink class="btn ghost" :to="{ name: 'admin-models' }">Models</RouterLink>
        <RouterLink class="btn ghost" :to="{ name: 'admin-tuning' }">Tuning</RouterLink>
      </div>
    </header>

    <StatusBanner v-if="loadError" tone="error">{{ loadError }}</StatusBanner>

    <div v-if="loading" class="skeletons" data-testid="calibration-loading">
      <SkeletonBlock height="4rem" />
      <SkeletonBlock height="10rem" />
    </div>

    <template v-else>
      <section class="panel" aria-label="Model for calibration">
        <AdminSelect
          v-if="modelOptions.length > 0"
          v-model="selectedId"
          label="Model to calibrate"
          :options="modelOptions"
          hint="ACTIVE for production checks, DRAFT to evaluate a candidate before activation."
          data-testid="calibration-model-select"
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
        </div>
        <p v-else class="muted">No ACTIVE or DRAFT models available.</p>
      </section>

      <section class="panel roadmap" aria-label="Upcoming calibration workflow" data-testid="calibration-shell">
        <h2>Coming next</h2>
        <ol>
          <li>Create or select a cohort</li>
          <li>Search and add characters (resolve missing characters from Blizzard)</li>
          <li>Label expected S / A / B / C / D rank</li>
          <li>Run the cohort against the selected model</li>
          <li>Compare expected vs calculated results</li>
        </ol>
        <p class="muted">
          Existing calibration APIs and cohort storage remain in place for the follow-up workflow.
          No simulated results are shown here.
        </p>
      </section>
    </template>
  </main>
</template>

<style scoped>
.admin-page {
  max-width: 52rem;
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
  color: var(--color-text-muted);
  line-height: 1.5;
  max-width: 40rem;
}

.header-actions {
  display: flex;
  gap: var(--space-2);
}

.panel {
  padding: var(--space-5);
  border-radius: var(--radius-card);
  border: 1px solid var(--color-border);
  background:
    linear-gradient(180deg, rgb(255 255 255 / 3%), transparent 45%),
    var(--color-surface);
  display: grid;
  gap: var(--space-4);
}

.selected-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
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

.roadmap h2 {
  margin: 0;
  font-size: var(--text-lg);
}

.roadmap ol {
  margin: 0;
  padding-left: 1.25rem;
  color: var(--color-text);
  line-height: 1.7;
}

.muted {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
  line-height: 1.5;
}

.btn {
  display: inline-flex;
  align-items: center;
  padding: 0.45rem 0.85rem;
  border-radius: var(--radius-control);
  border: 1px solid var(--color-border);
  color: var(--color-text);
  text-decoration: none;
  font-size: var(--text-sm);
  font-weight: 600;
}

.btn:hover {
  background: var(--color-surface-hover);
}

.skeletons {
  display: grid;
  gap: var(--space-3);
}
</style>
