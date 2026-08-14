<script setup lang="ts">
import { computed, defineAsyncComponent, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

const AdminModelsPage = defineAsyncComponent(() => import("./AdminModelsPage.vue"));
const AdminTuningPage = defineAsyncComponent(() => import("./AdminTuningPage.vue"));
const AdminCalibrationPage = defineAsyncComponent(() => import("./AdminCalibrationPage.vue"));
const AdminScoreContextPage = defineAsyncComponent(() => import("./AdminScoreContextPage.vue"));

type ScoringTab = "models" | "tuning" | "calibration" | "context";

const route = useRoute();
const router = useRouter();

const TABS: { id: ScoringTab; label: string }[] = [
  { id: "models", label: "Models" },
  { id: "tuning", label: "Tuning" },
  { id: "calibration", label: "Calibration" },
  { id: "context", label: "Key + Meta" },
];

const activeTab = computed<ScoringTab>(() => {
  const raw = String(route.params.tab ?? "models").toLowerCase();
  if (raw === "tuning" || raw === "calibration" || raw === "models" || raw === "context") return raw;
  return "models";
});

function selectTab(tab: ScoringTab): void {
  if (tab === activeTab.value) return;
  void router.push({
    name: "admin-scoring",
    params: { tab },
    query: tab === "tuning" ? route.query : tab === "calibration" ? route.query : {},
  });
}

watch(
  () => route.params.tab,
  (tab) => {
    if (!tab) {
      void router.replace({ name: "admin-scoring", params: { tab: "models" } });
    }
  },
  { immediate: true },
);
</script>

<template>
  <section class="scoring-console" data-testid="admin-scoring-console">
    <header class="scoring-console__header">
      <h1>Scoring</h1>
      <p class="muted">Models lifecycle, weight tuning, and calibration cohorts.</p>
    </header>

    <nav class="tabs" aria-label="Scoring sections">
      <button
        v-for="tab in TABS"
        :key="tab.id"
        type="button"
        class="tab"
        :class="{ 'tab--active': activeTab === tab.id }"
        :data-testid="`tab-${tab.id}`"
        @click="selectTab(tab.id)"
      >
        {{ tab.label }}
      </button>
    </nav>

    <div class="scoring-console__panel" :data-tab="activeTab">
      <AdminModelsPage v-if="activeTab === 'models'" embedded />
      <AdminTuningPage v-else-if="activeTab === 'tuning'" embedded />
      <AdminCalibrationPage v-else-if="activeTab === 'calibration'" embedded />
      <AdminScoreContextPage v-else embedded />
    </div>
  </section>
</template>

<style scoped>
.scoring-console {
  display: grid;
  gap: var(--space-4);
}

.scoring-console__header h1 {
  margin: 0;
  font-size: var(--text-2xl);
}

.muted {
  margin: 0.25rem 0 0;
  color: var(--color-text-muted);
}

.tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  border-bottom: 1px solid var(--color-border);
  padding-bottom: 0.35rem;
}

.tab {
  appearance: none;
  border: 1px solid transparent;
  background: transparent;
  color: var(--color-text-muted);
  font: inherit;
  font-weight: 600;
  padding: 0.45rem 0.85rem;
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  cursor: pointer;
}

.tab:hover {
  color: var(--color-text);
}

.tab--active {
  color: var(--color-text);
  border-color: var(--color-border);
  border-bottom-color: var(--color-surface);
  background: var(--color-surface);
}

.scoring-console__panel :deep(.admin-page__header) {
  display: none;
}

.scoring-console__panel :deep(.admin-page) {
  padding: 0;
  margin: 0;
  max-width: none;
}
</style>
