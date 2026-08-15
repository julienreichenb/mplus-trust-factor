<script setup lang="ts">
import type { FaqEmbedType } from "@mplus/contracts";
import FaqMetaTierArtifact from "./FaqMetaTierArtifact.vue";
import FaqKeyPercentileArtifact from "./FaqKeyPercentileArtifact.vue";
import FaqScoreFlowArtifact from "./FaqScoreFlowArtifact.vue";
import FaqScoringDimensionsArtifact from "./FaqScoringDimensionsArtifact.vue";
import FaqTrustGradeLadderArtifact from "./FaqTrustGradeLadderArtifact.vue";

defineProps<{
  type: FaqEmbedType | null;
}>();
</script>

<template>
  <div v-if="type" class="faq-embed" data-testid="faq-embedded-artifact" :data-embed-type="type">
    <FaqMetaTierArtifact v-if="type === 'META_TIER_TABLE'" />
    <FaqKeyPercentileArtifact v-else-if="type === 'KEY_PERCENTILE_TABLE'" />
    <FaqScoreFlowArtifact v-else-if="type === 'SCORE_FLOW'" />
    <FaqScoringDimensionsArtifact v-else-if="type === 'SCORING_DIMENSIONS'" />
    <FaqTrustGradeLadderArtifact v-else-if="type === 'TRUST_GRADE_LADDER'" />
  </div>
</template>

<style scoped>
.faq-embed {
  margin-top: var(--space-4);
}
</style>
