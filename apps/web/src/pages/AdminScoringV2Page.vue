<script setup lang="ts">
import { ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import ScoringV2OverviewPanel from "../components/scoring-v2/ScoringV2OverviewPanel.vue";
import ScoringV2EvidencePanel from "../components/scoring-v2/ScoringV2EvidencePanel.vue";
import ScoringV2ConcurrencyPanel from "../components/scoring-v2/ScoringV2ConcurrencyPanel.vue";
import ScoringV2DiagnosticsPanel from "../components/scoring-v2/ScoringV2DiagnosticsPanel.vue";
import ScoringV2HistoryPanel from "../components/scoring-v2/ScoringV2HistoryPanel.vue";

type TabId = "overview" | "evidence" | "concurrency" | "diagnostics" | "history";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "evidence", label: "Calibration evidence" },
  { id: "concurrency", label: "Concurrency" },
  { id: "diagnostics", label: "Diagnostics" },
  { id: "history", label: "History" },
];

const route = useRoute();
const router = useRouter();

function tabFromQuery(raw: unknown): TabId {
  const value = typeof raw === "string" ? raw : "";
  return TABS.some((t) => t.id === value) ? (value as TabId) : "overview";
}

const activeTab = ref<TabId>(tabFromQuery(route.query.tab));

watch(
  () => route.query.tab,
  (next) => {
    activeTab.value = tabFromQuery(next);
  },
);

function selectTab(id: TabId): void {
  activeTab.value = id;
  void router.replace({ query: { ...route.query, tab: id === "overview" ? undefined : id } });
}
</script>

<template>
  <main class="admin-page" aria-labelledby="scoring-v2-cc-title">
    <header class="admin-page__header">
      <h1 id="scoring-v2-cc-title">Scoring V2 Control Center</h1>
      <p>
        Operational overview, calibration evidence export, concurrency lanes, diagnostics, and
        history. Feature flags stay disabled unless changed outside this page.
      </p>
    </header>

    <nav class="tabs" aria-label="Scoring V2 Control Center sections">
      <button
        v-for="tab in TABS"
        :key="tab.id"
        type="button"
        class="tabs__btn"
        :class="{ 'tabs__btn--active': activeTab === tab.id }"
        :aria-current="activeTab === tab.id ? 'page' : undefined"
        @click="selectTab(tab.id)"
      >
        {{ tab.label }}
      </button>
    </nav>

    <ScoringV2OverviewPanel v-if="activeTab === 'overview'" />
    <ScoringV2EvidencePanel v-else-if="activeTab === 'evidence'" />
    <ScoringV2ConcurrencyPanel v-else-if="activeTab === 'concurrency'" />
    <ScoringV2DiagnosticsPanel v-else-if="activeTab === 'diagnostics'" />
    <ScoringV2HistoryPanel v-else />
  </main>
</template>

<style scoped>
.admin-page {
  display: grid;
  gap: var(--space-4, 1rem);
  padding: var(--space-4, 1rem);
  max-width: 1100px;
}

.admin-page__header h1 {
  margin: 0 0 0.35rem;
  font-size: 1.5rem;
}

.admin-page__header p {
  margin: 0;
  opacity: 0.85;
}

.tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  border-bottom: 1px solid color-mix(in srgb, currentColor 18%, transparent);
  padding-bottom: 0.35rem;
}

.tabs__btn {
  appearance: none;
  background: transparent;
  border: 1px solid transparent;
  padding: 0.4rem 0.7rem;
  cursor: pointer;
  font: inherit;
}

.tabs__btn--active {
  border-color: color-mix(in srgb, currentColor 28%, transparent);
  font-weight: 600;
}

.tabs__btn:focus-visible {
  outline: 2px solid color-mix(in srgb, currentColor 45%, transparent);
  outline-offset: 2px;
}
</style>
