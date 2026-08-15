<script setup lang="ts">
import { computed, onMounted } from "vue";
import StatusBanner from "../common/StatusBanner.vue";
import ScoreContextKeyTable from "../score-context/ScoreContextKeyTable.vue";
import { usePublishedScoringContext } from "../../composables/usePublishedScoringContext";

const { data, error, loading, ensure } = usePublishedScoringContext();
onMounted(() => {
  void ensure();
});

const provenance = computed(() => {
  const snaps = data.value?.key?.regionalSnapshots;
  if (!snaps) return null;
  const dates = (["EU", "US", "KR", "TW"] as const)
    .map((code) => snaps[code]?.collectedAt)
    .filter((value): value is string => Boolean(value));
  const source = snaps.EU?.source ?? snaps.US?.source ?? snaps.KR?.source ?? snaps.TW?.source;
  if (!dates.length && !source) return null;
  const latest = dates.sort().at(-1);
  return { source, latest };
});
</script>

<template>
  <section class="artifact" data-testid="faq-key-artifact">
    <h3>Current Key Difficulty bands</h3>
    <p v-if="data?.scoringSeason || data?.revision" class="muted context">
      <span v-if="data.scoringSeason">{{ data.scoringSeason.name }}</span>
      <span v-if="data.revision"> · published revision v{{ data.revision.version }}</span>
      <span v-if="provenance?.latest"> · snapshot {{ provenance.latest.slice(0, 10) }}</span>
    </p>
    <p v-if="loading" class="muted">Loading published Key context…</p>
    <StatusBanner v-else-if="error || !data?.available || !data.key" tone="warn">
      {{ error || data?.unavailableReason || "Current Key Difficulty context is temporarily unavailable." }}
    </StatusBanner>
    <ScoreContextKeyTable
      v-else
      :rows="data.key.rows"
      :unavailable="data.key.unavailable"
      :read-only="true"
    />
  </section>
</template>

<style scoped>
.artifact {
  display: grid;
  gap: var(--space-3);
}
h3 {
  margin: 0;
  font-family: var(--font-body);
  font-size: var(--text-base);
}
.muted {
  color: var(--color-text-muted);
  margin: 0;
  font-size: var(--text-sm);
}
</style>
