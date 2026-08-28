<script setup lang="ts">
import { computed, defineAsyncComponent, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

const AdminAbilityCatalogPage = defineAsyncComponent(() => import("./AdminAbilityCatalogPage.vue"));
const AdminAbilityCatalogReviewPage = defineAsyncComponent(
  () => import("./AdminAbilityCatalogReviewPage.vue"),
);
const AdminAbilityCatalogReleasesPage = defineAsyncComponent(
  () => import("./AdminAbilityCatalogReleasesPage.vue"),
);

type AbilityCatalogTab = "catalog" | "review" | "releases";

const route = useRoute();
const router = useRouter();

const TABS: { id: AbilityCatalogTab; label: string }[] = [
  { id: "catalog", label: "Catalog" },
  { id: "review", label: "Review" },
  { id: "releases", label: "Releases" },
];

const activeTab = computed<AbilityCatalogTab>(() => {
  const raw = String(route.params.tab ?? "catalog").toLowerCase();
  if (raw === "review" || raw === "releases" || raw === "catalog") return raw;
  return "catalog";
});

function selectTab(tab: AbilityCatalogTab): void {
  if (tab === activeTab.value) return;
  void router.push({
    name: "admin-ability-catalog",
    params: { tab },
    query: tab === "catalog" ? route.query : {},
  });
}

watch(
  () => route.params.tab,
  (tab) => {
    if (!tab) {
      void router.replace({
        name: "admin-ability-catalog",
        params: { tab: "catalog" },
        query: route.query,
      });
    }
  },
  { immediate: true },
);
</script>

<template>
  <section class="ability-catalog-console" data-testid="admin-ability-catalog-console">
    <header class="ability-catalog-console__header">
      <h1>Ability catalog</h1>
      <p class="muted">
        Catalog control center — explorer, review queue, and release activation. New analyses always
        pin the ACTIVE immutable release.
      </p>
    </header>

    <nav class="tabs" aria-label="Ability catalog sections">
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

    <div class="ability-catalog-console__panel" :data-tab="activeTab">
      <AdminAbilityCatalogPage v-if="activeTab === 'catalog'" embedded />
      <AdminAbilityCatalogReviewPage v-else-if="activeTab === 'review'" embedded />
      <AdminAbilityCatalogReleasesPage v-else embedded />
    </div>
  </section>
</template>

<style scoped>
.ability-catalog-console {
  display: grid;
  gap: var(--space-4);
}

.ability-catalog-console__header h1 {
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

.ability-catalog-console__panel :deep(.admin-page__header),
.ability-catalog-console__panel :deep(.review-page__header),
.ability-catalog-console__panel :deep(.releases-page__header),
.ability-catalog-console__panel :deep(.catalog-page__header) {
  display: none;
}

.ability-catalog-console__panel :deep(.admin-page),
.ability-catalog-console__panel :deep(.review-page),
.ability-catalog-console__panel :deep(.releases-page),
.ability-catalog-console__panel :deep(.catalog-page) {
  padding: 0;
  margin: 0;
  max-width: none;
}
</style>
