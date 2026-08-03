<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
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
const tabRefs = ref<Array<HTMLButtonElement | null>>([]);

watch(
  () => route.query.tab,
  (next) => {
    activeTab.value = tabFromQuery(next);
  },
);

function selectTab(id: TabId, focusTab = false): void {
  activeTab.value = id;
  void router.replace({ query: { ...route.query, tab: id === "overview" ? undefined : id } });
  if (focusTab) {
    void nextTick(() => {
      const idx = TABS.findIndex((t) => t.id === id);
      tabRefs.value[idx]?.focus();
    });
  }
}

function onTabKeydown(event: KeyboardEvent): void {
  const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
  if (!keys.includes(event.key)) return;
  event.preventDefault();
  const current = TABS.findIndex((t) => t.id === activeTab.value);
  let next = current;
  if (event.key === "ArrowLeft") next = (current - 1 + TABS.length) % TABS.length;
  else if (event.key === "ArrowRight") next = (current + 1) % TABS.length;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = TABS.length - 1;
  selectTab(TABS[next]!.id, true);
}

const panelId = computed(() => `scoring-v2-panel-${activeTab.value}`);
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

    <div
      class="tabs"
      role="tablist"
      aria-label="Scoring V2 Control Center sections"
      @keydown="onTabKeydown"
    >
      <button
        v-for="(tab, index) in TABS"
        :id="`scoring-v2-tab-${tab.id}`"
        :key="tab.id"
        :ref="(el) => { tabRefs[index] = el as HTMLButtonElement | null }"
        type="button"
        class="tabs__btn"
        role="tab"
        :class="{ 'tabs__btn--active': activeTab === tab.id }"
        :aria-selected="activeTab === tab.id"
        :aria-controls="`scoring-v2-panel-${tab.id}`"
        :tabindex="activeTab === tab.id ? 0 : -1"
        @click="selectTab(tab.id)"
      >
        {{ tab.label }}
      </button>
    </div>

    <div
      :id="panelId"
      class="tabpanel"
      role="tabpanel"
      :aria-labelledby="`scoring-v2-tab-${activeTab}`"
      tabindex="0"
    >
      <ScoringV2OverviewPanel v-if="activeTab === 'overview'" />
      <ScoringV2EvidencePanel v-else-if="activeTab === 'evidence'" />
      <ScoringV2ConcurrencyPanel v-else-if="activeTab === 'concurrency'" />
      <ScoringV2DiagnosticsPanel v-else-if="activeTab === 'diagnostics'" />
      <ScoringV2HistoryPanel v-else />
    </div>
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

.tabs__btn:focus-visible,
.tabpanel:focus-visible {
  outline: 2px solid color-mix(in srgb, currentColor 45%, transparent);
  outline-offset: 2px;
}

.tabpanel {
  min-width: 0;
}
</style>
