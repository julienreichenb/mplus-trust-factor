<script setup lang="ts">
import { onMounted } from "vue";
import StatusBanner from "../common/StatusBanner.vue";
import ScoreContextMetaTierList from "../score-context/ScoreContextMetaTierList.vue";
import { usePublishedScoringContext } from "../../composables/usePublishedScoringContext";

const { data, error, loading, ensure } = usePublishedScoringContext();
onMounted(() => {
  void ensure();
});
</script>

<template>
  <section class="artifact" data-testid="faq-meta-artifact">
    <h3>Current specialization tiers</h3>
    <p v-if="data?.scoringSeason || data?.revision" class="muted context">
      <span v-if="data.scoringSeason">{{ data.scoringSeason.name }}</span>
      <span v-if="data.revision"> · published revision v{{ data.revision.version }}</span>
    </p>
    <p v-if="loading" class="muted">Loading published Meta context…</p>
    <StatusBanner v-else-if="error || !data?.available || !data.meta" tone="warn">
      {{ error || data?.unavailableReason || "Current Meta context is temporarily unavailable." }}
    </StatusBanner>
    <ScoreContextMetaTierList
      v-else
      :classes="data.meta.classes"
      :assignments="data.meta.assignments"
      :tier-factors="data.meta.tierFactors"
      :read-only="true"
    />
    <p v-if="data?.available" class="muted note">
      These tiers reflect the currently published Meta context and may change as the season evolves.
    </p>
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
.note {
  line-height: 1.5;
}
</style>
