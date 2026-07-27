<script setup lang="ts">
const features = [
  {
    title: "Explainable trust score",
    body: "Every S–D tier pairs with dimensions, weights and source evidence — not a black-box rank.",
  },
  {
    title: "Multi-dimensional analysis",
    body: "Performance, consistency, progression and evidence quality are scored as separate signals.",
  },
  {
    title: "Designed for high-key players",
    body: "Built for group leaders and competitive players evaluating potential teammates.",
  },
  {
    title: "Freshness and confidence",
    body: "Results surface data freshness and confidence so incomplete evidence stays visible.",
  },
  {
    title: "Transparent methodology",
    body: "Model version, weighting and limitations stay inspectable alongside the score.",
  },
] as const;
</script>

<template>
  <section id="features" class="features" aria-labelledby="features-title">
    <header class="features__header">
      <p class="eyebrow">Built for serious M+ players</p>
      <h2 id="features-title">What the trust score gives you</h2>
      <p>
        Precise screening signals for expert Mythic+ groups — without pretending every future
        detail view is shipped today.
      </p>
    </header>

    <ul class="features__grid">
      <li v-for="feature in features" :key="feature.title">
        <span class="features__icon" aria-hidden="true" />
        <h3>{{ feature.title }}</h3>
        <p>{{ feature.body }}</p>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.features {
  display: grid;
  gap: var(--space-8);
}

.features__header {
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

.features__header h2 {
  margin: 0 0 var(--space-3);
}

.features__header p {
  margin: 0;
}

.features__grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-5);
}

.features__grid li {
  display: grid;
  gap: var(--space-2);
  padding: 0;
  border: none;
  background: transparent;
}

.features__icon {
  width: 2rem;
  height: 2rem;
  border-radius: var(--radius-control);
  border: 1px solid rgb(244 213 141 / 35%);
  background:
    linear-gradient(135deg, rgb(245 158 11 / 25%), transparent 60%),
    var(--color-iron-800);
}

.features__grid h3 {
  margin: 0;
}

.features__grid p {
  margin: 0;
  font-size: var(--text-sm);
  max-width: 28rem;
}

@media (min-width: 768px) {
  .features__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-6) var(--space-8);
  }
}

@media (min-width: 1024px) {
  .features__grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .features__grid li:nth-child(4),
  .features__grid li:nth-child(5) {
    grid-column: span 1;
  }
}
</style>
