<script setup lang="ts">
import { onMounted } from "vue";
import DimensionAxisIcon from "../charts/DimensionAxisIcon.vue";
import { usePublicScoreModel } from "../../composables/usePublicScoreModel";

const { dimensions, ensure } = usePublicScoreModel();
onMounted(() => {
  void ensure();
});
</script>

<template>
  <section class="flow" data-testid="faq-score-flow">
    <div class="dims" data-testid="faq-score-flow-dimensions">
      <div v-for="dim in dimensions" :key="dim.key" class="dim">
        <DimensionAxisIcon :dimension="dim.key" />
        <strong>{{ dim.label }}</strong>
        <span v-if="dim.weightLabel" class="muted">{{ dim.weightLabel }}</span>
      </div>
    </div>
    <div class="arrow" aria-hidden="true">↓</div>
    <div class="step" data-testid="faq-score-flow-raw">Raw Trust Score</div>
    <div class="arrow" aria-hidden="true">↓</div>
    <div class="step" data-testid="faq-score-flow-key">× Key Difficulty factor</div>
    <div class="arrow" aria-hidden="true">↓</div>
    <div class="step" data-testid="faq-score-flow-meta">× Meta factor</div>
    <div class="arrow" aria-hidden="true">↓</div>
    <div class="step step--final" data-testid="faq-score-flow-final">Final Trust Score</div>
    <p class="muted note">Final is Raw multiplied by both factors, then capped at 100 when needed.</p>
  </section>
</template>

<style scoped>
.flow {
  display: grid;
  justify-items: center;
  gap: var(--space-2);
  text-align: center;
}
.dims {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-2);
  width: 100%;
}
.dim {
  display: grid;
  justify-items: center;
  gap: 0.2rem;
  padding: var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  background: var(--color-surface);
  font-size: var(--text-sm);
}
.step {
  width: 100%;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  background: var(--color-surface);
  font-weight: 600;
}
.step--final {
  border-color: color-mix(in srgb, var(--color-gold-300) 40%, var(--color-border));
}
.arrow {
  color: var(--color-text-muted);
  line-height: 1;
}
.muted {
  color: var(--color-text-muted);
  margin: 0;
  font-size: var(--text-sm);
}
.note {
  line-height: 1.5;
}
@media (min-width: 640px) {
  .dims {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
</style>
