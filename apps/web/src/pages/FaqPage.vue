<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import type { PublicFaqEntryDTO } from "@mplus/contracts";
import { api } from "../api/client";
import StatusBanner from "../components/common/StatusBanner.vue";
import DisclosureChevron from "../components/ability-catalog/DisclosureChevron.vue";
import FaqEmbeddedArtifact from "../components/faq/FaqEmbeddedArtifact.vue";
import { filterFaqEntries } from "../lib/faqSearch";

const loading = ref(true);
const error = ref<string | null>(null);
const entries = ref<PublicFaqEntryDTO[]>([]);
const query = ref("");
const openFaqId = ref<string | null>(null);

const filtered = computed(() => filterFaqEntries(entries.value, query.value));

function toggleFaq(id: string): void {
  openFaqId.value = openFaqId.value === id ? null : id;
}

function isOpen(id: string): boolean {
  return openFaqId.value === id;
}

watch(filtered, (next) => {
  if (openFaqId.value && !next.some((entry) => entry.id === openFaqId.value)) {
    openFaqId.value = null;
  }
});

onMounted(async () => {
  loading.value = true;
  error.value = null;
  try {
    const response = await api.listFaq();
    entries.value = response.entries;
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <section class="faq-page" data-testid="faq-page">
    <header class="faq-page__header">
      <h1>FAQ</h1>
      <p>
        Find answers about M+ Trust Factor, scoring and player data.
      </p>
    </header>

    <label class="faq-search">
      <span class="sr-only">Search FAQs</span>
      <input
        v-model="query"
        type="search"
        class="admin-control"
        placeholder="Search FAQs..."
        data-testid="faq-search"
        autocomplete="off"
      />
    </label>

    <StatusBanner v-if="error" tone="error" data-testid="faq-error">{{ error }}</StatusBanner>
    <p v-else-if="loading" class="muted" data-testid="faq-loading">Loading FAQ…</p>
    <p
      v-else-if="entries.length === 0"
      class="muted"
      data-testid="faq-empty"
    >
      No FAQ entries are available yet.
    </p>
    <p
      v-else-if="filtered.length === 0"
      class="muted"
      data-testid="faq-no-results"
    >
      No FAQs found
    </p>

    <div v-else class="faq-list" data-testid="faq-list">
      <article
        v-for="entry in filtered"
        :key="entry.id"
        class="faq-item"
        :data-open="isOpen(entry.id) ? 'true' : 'false'"
        data-testid="faq-item"
      >
        <h2 class="faq-item__heading">
          <button
            :id="`faq-trigger-${entry.id}`"
            type="button"
            class="faq-item__trigger"
            :aria-expanded="isOpen(entry.id)"
            :aria-controls="`faq-panel-${entry.id}`"
            data-testid="faq-item-trigger"
            @click="toggleFaq(entry.id)"
          >
            <span>{{ entry.title }}</span>
            <DisclosureChevron :expanded="isOpen(entry.id)" />
          </button>
        </h2>
        <div
          :id="`faq-panel-${entry.id}`"
          class="faq-item__collapse"
          role="region"
          :aria-labelledby="`faq-trigger-${entry.id}`"
          :aria-hidden="isOpen(entry.id) ? undefined : 'true'"
          data-testid="faq-item-panel"
        >
          <div class="faq-item__panel">
            <p class="faq-item__body">{{ entry.description }}</p>
            <FaqEmbeddedArtifact v-if="isOpen(entry.id) && entry.embedType" :type="entry.embedType" />
          </div>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.faq-page {
  max-width: 64rem;
  display: grid;
  gap: var(--space-5);
}

.faq-page__header p {
  margin: 0;
  max-width: 38rem;
}

.faq-search input {
  width: 100%;
}

.faq-search input:focus-visible {
  outline: none;
  border-color: var(--color-focus);
  box-shadow: 0 0 0 2px rgb(251 191 36 / 35%);
}

.muted {
  color: var(--color-text-muted);
  margin: 0;
}

.faq-list {
  display: grid;
  gap: var(--space-2);
}

.faq-item {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  background: var(--color-surface);
}

.faq-item[data-open="true"] {
  border-color: color-mix(in srgb, var(--color-gold-300) 40%, var(--color-border));
}

.faq-item__heading {
  margin: 0;
  font-family: var(--font-body);
  font-size: var(--text-base);
  font-weight: 600;
}

.faq-item__trigger {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin: 0;
  padding: var(--space-3) var(--space-4);
  border: 0;
  background: transparent;
  color: var(--color-text);
  text-align: left;
  cursor: pointer;
  border-radius: var(--radius-card);
}

.faq-item__trigger:hover {
  background: var(--color-surface-hover);
}

.faq-item__trigger:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}

.faq-item__collapse {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.32s ease;
}

.faq-item[data-open="true"] .faq-item__collapse {
  grid-template-rows: 1fr;
}

.faq-item__panel {
  overflow: hidden;
  min-height: 0;
  padding: 0 var(--space-4);
  transition: padding-bottom 0.32s ease;
}

.faq-item[data-open="true"] .faq-item__panel {
  padding-bottom: var(--space-4);
}

@media (prefers-reduced-motion: reduce) {
  .faq-item__collapse,
  .faq-item__panel {
    transition: none;
  }
}

.faq-item__body {
  margin: 0;
  white-space: pre-wrap;
  color: var(--color-text-muted);
  line-height: 1.6;
}
</style>
