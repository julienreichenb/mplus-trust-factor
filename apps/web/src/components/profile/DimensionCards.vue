<script setup lang="ts">
import { computed } from "vue";
import type { DimensionScoreDTO } from "@mplus/contracts";
import { DIMENSION_LABELS, type RadarDimension, formatPercent, formatScore, formatWeight } from "../../lib/format";

const props = defineProps<{
  dimensions: DimensionScoreDTO[];
  locked?: boolean;
}>();

const cards = computed(() =>
  props.dimensions
    .filter((d) => d.dimension !== "AUTHENTICITY")
    .map((d) => {
      const contrib = d.contributors as
        | { positive?: Array<{ label: string }>; negative?: Array<{ label: string }> }
        | null;
      return {
        ...d,
        label: DIMENSION_LABELS[d.dimension as RadarDimension] ?? d.dimension,
        positive: contrib?.positive?.[0]?.label ?? "—",
        negative: contrib?.negative?.[0]?.label ?? "—",
      };
    }),
);
</script>

<template>
  <section aria-labelledby="dimensions-title">
    <h2 id="dimensions-title">Dimensions</h2>
    <p v-if="locked" class="locked">Detailed dimension breakdown is locked by entitlement.</p>
    <div v-else class="grid">
      <article v-for="card in cards" :key="card.dimension" class="card">
        <h3>{{ card.label }}</h3>
        <p class="score">{{ formatScore(card.score, 0) }} <span>/ 100</span></p>
        <dl>
          <div>
            <dt>Weight</dt>
            <dd>{{ formatWeight(card.weight) }}</dd>
          </div>
          <div>
            <dt>Confidence</dt>
            <dd>{{ formatPercent(card.confidence * 100, 0) }}</dd>
          </div>
        </dl>
        <p class="contrib"><strong>+</strong> {{ card.positive }}</p>
        <p class="contrib"><strong>−</strong> {{ card.negative }}</p>
      </article>
    </div>
  </section>
</template>

<style scoped>
.grid {
  display: grid;
  gap: 0.75rem;
  grid-template-columns: 1fr;
}

@media (min-width: 700px) {
  .grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (min-width: 1100px) {
  .grid {
    grid-template-columns: repeat(3, 1fr);
  }
}

.card {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  padding: var(--space-4);
  background: var(--color-surface);
}

.card h3 {
  margin: 0 0 0.35rem;
  font-size: var(--text-base);
}

.score {
  font-size: var(--text-2xl);
  font-weight: 700;
  margin: 0;
  font-family: var(--font-data);
  color: var(--color-gold-300);
}

.score span {
  color: var(--color-text-muted);
  font-size: var(--text-sm);
  font-weight: 500;
}

dl {
  display: flex;
  gap: 1rem;
  margin: 0.5rem 0;
}

dt {
  font-size: var(--text-xs);
  text-transform: uppercase;
  color: var(--color-text-muted);
}

dd {
  margin: 0.1rem 0 0;
  font-weight: 600;
}

.contrib {
  margin: 0.25rem 0 0;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

.locked {
  color: var(--color-text-muted);
}
</style>
