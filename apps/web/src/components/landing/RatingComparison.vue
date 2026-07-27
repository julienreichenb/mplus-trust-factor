<script setup lang="ts">
const rows = [
  {
    label: "Mythic+ rating",
    points: [
      "Shows what keys were completed and timed.",
      "Rewards group outcome and season volume.",
      "Does not expose personal execution quality.",
    ],
  },
  {
    label: "M+ Trust Factor",
    points: [
      "Explains how the player performed in selected runs.",
      "Separates Performance, Survival, Utility and Experience.",
      "Surfaces confidence, missing logs and evidence.",
    ],
  },
] as const;
</script>

<template>
  <section id="comparison" class="comparison" aria-labelledby="comparison-title" data-testid="rating-comparison">
    <header class="comparison__header">
      <p class="eyebrow">Why rating alone is insufficient</p>
      <h2 id="comparison-title">Completion rating vs execution trust</h2>
      <p>
        A high rating can come from strong play — or from being carried. Trust Factor inspects the
        same season through evidence, not completion alone.
      </p>
    </header>

    <div class="comparison__grid">
      <article v-for="row in rows" :key="row.label" class="comparison__col">
        <h3>{{ row.label }}</h3>
        <ul>
          <li v-for="point in row.points" :key="point">{{ point }}</li>
        </ul>
      </article>
    </div>
  </section>
</template>

<style scoped>
.comparison {
  display: grid;
  gap: var(--space-8);
}

.comparison__header {
  max-width: var(--container-reading);
}

.eyebrow {
  margin: 0 0 var(--space-2);
  font-family: var(--font-data);
  font-size: var(--text-xs);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-gold-300);
}

.comparison__header h2 {
  margin: 0 0 var(--space-3);
}

.comparison__header p {
  margin: 0;
}

.comparison__grid {
  display: grid;
  gap: var(--space-6);
  padding: var(--space-6) 0;
  border-top: 1px solid var(--color-border);
  border-bottom: 1px solid var(--color-border);
}

.comparison__col h3 {
  margin: 0 0 var(--space-3);
  font-family: var(--font-display);
  font-size: var(--text-xl);
  color: var(--color-text);
}

.comparison__col ul {
  margin: 0;
  padding-left: 1.1rem;
  display: grid;
  gap: var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

@media (min-width: 768px) {
  .comparison__grid {
    grid-template-columns: 1fr 1fr;
    gap: var(--space-10);
  }
}
</style>
