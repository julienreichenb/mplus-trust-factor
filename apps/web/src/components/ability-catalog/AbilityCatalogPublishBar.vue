<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api } from "../../api/client";
import { ApiClientError } from "../../api/live-client";
import StatusBanner from "../common/StatusBanner.vue";

const emit = defineEmits<{
  published: [];
}>();

const loading = ref(true);
const publishing = ref(false);
const error = ref<string | null>(null);
const success = ref<string | null>(null);
const status = ref<Record<string, unknown> | null>(null);

const publishLabel = computed(() => {
  const kind = String(status.value?.status ?? "NO_CHANGES");
  if (kind === "READY") return "Publish changes";
  if (kind === "BLOCKED") return "Publish blocked";
  if (kind === "NEEDS_CLASSIFICATION") return "Nothing ready to publish";
  return "No unpublished changes";
});

const canPublish = computed(() => status.value?.status === "READY" && !publishing.value);

const statusLine = computed(() => {
  const pending = status.value?.pending as Record<string, number> | undefined;
  if (!pending) return "";
  const parts: string[] = [];
  if (pending.readyDraftCount) parts.push(`${pending.readyDraftCount} draft change(s)`);
  if (pending.pendingExclusionCount) parts.push(`${pending.pendingExclusionCount} exclusion(s)`);
  if (pending.confirmedRemovalCount) parts.push(`${pending.confirmedRemovalCount} removal(s)`);
  if (pending.readyTopologyCount) parts.push(`${pending.readyTopologyCount} topology change(s)`);
  if (pending.unclassifiedCandidateCount) {
    parts.push(`${pending.unclassifiedCandidateCount} need classification`);
  }
  return parts.join(" · ");
});

async function loadStatus(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    status.value = await api.getAbilityCatalogPublishStatus();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to load publish status";
  } finally {
    loading.value = false;
  }
}

async function publish(): Promise<void> {
  if (!canPublish.value) return;
  if (
    !window.confirm(
      "Publish all pending catalog changes? This compiles, validates, replays, and activates a new release.",
    )
  ) {
    return;
  }
  publishing.value = true;
  error.value = null;
  success.value = null;
  try {
    const activeId =
      typeof status.value?.activeReleaseId === "string" ? status.value.activeReleaseId : null;
    const result = await api.publishAbilityCatalogChanges({
      expectedPreviousActiveId: activeId,
    });
    if (!result.success) {
      error.value = `${result.message} (${result.stage})`;
      await loadStatus();
      return;
    }
    success.value = result.message || "Catalog published successfully.";
    emit("published");
    await loadStatus();
  } catch (err) {
    error.value = err instanceof ApiClientError ? err.message : "Publish failed";
  } finally {
    publishing.value = false;
  }
}

onMounted(() => {
  void loadStatus();
});

defineExpose({ reload: loadStatus });
</script>

<template>
  <section class="publish-bar" data-testid="catalog-publish-bar">
    <div class="publish-bar__main">
      <div>
        <strong>Publication</strong>
        <p v-if="!loading" class="muted publish-bar__line">
          <span v-if="status?.activeReleaseKey">
            Active <code>{{ status.activeReleaseKey }}</code>
            <span v-if="status.activeContentDigestShort">
              · {{ status.activeContentDigestShort }}
            </span>
          </span>
          <span v-if="statusLine"> · {{ statusLine }}</span>
        </p>
        <p v-else class="muted">Loading publish status…</p>
      </div>
      <button
        type="button"
        class="btn primary"
        data-testid="publish-catalog"
        :disabled="!canPublish"
        @click="publish"
      >
        {{ publishing ? "Publishing…" : publishLabel }}
      </button>
    </div>
    <StatusBanner v-if="error" tone="error">{{ error }}</StatusBanner>
    <StatusBanner v-if="success" tone="success">{{ success }}</StatusBanner>
    <ul
      v-if="Array.isArray(status?.blockingIssues) && status.blockingIssues.length"
      class="blocking-list"
    >
      <li v-for="(issue, idx) in status.blockingIssues" :key="idx">
        {{ (issue as { message?: string }).message }}
      </li>
    </ul>
  </section>
</template>

<style scoped>
.publish-bar {
  display: grid;
  gap: 0.65rem;
  padding: 0.85rem 1rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  background: var(--color-surface);
}

.publish-bar__main {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.publish-bar__line {
  margin: 0.2rem 0 0;
}

.blocking-list {
  margin: 0;
  padding-left: 1.1rem;
  color: var(--color-danger, #c44);
  font-size: 0.9rem;
}

.btn.primary {
  font-weight: 700;
}
</style>
