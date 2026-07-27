<script setup lang="ts">
const steps = [
  "Select the highest-key run for each active-season dungeon (eight when the pool is full).",
  "Score Performance, Survival and Utility on that shared run set.",
  "Blend Experience / consistency from season volume and breadth.",
  "Publish Trust Factor with confidence, freshness and missing-data notes.",
] as const;
</script>

<template>
  <section id="eight-runs" class="eight" aria-labelledby="eight-title" data-testid="eight-run-explainer">
    <header>
      <p class="eyebrow">Shared evidence set</p>
      <h2 id="eight-title">Eight highest keys, one per dungeon</h2>
      <p>
        Execution dimensions use the same selected runs. Missing Warcraft Logs matches lower
        confidence — they never invent zeros.
      </p>
    </header>

    <ol class="eight__steps">
      <li v-for="(step, index) in steps" :key="step">
        <span class="eight__n mpts-data">{{ index + 1 }}</span>
        <span>{{ step }}</span>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.eight {
  display: grid;
  gap: var(--space-6);
  max-width: 52rem;
}

.eyebrow {
  margin: 0 0 var(--space-2);
  font-family: var(--font-data);
  font-size: var(--text-xs);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-gold-300);
}

header h2 {
  margin: 0 0 var(--space-3);
}

header p {
  margin: 0;
}

.eight__steps {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-4);
}

.eight__steps li {
  display: grid;
  grid-template-columns: 2rem 1fr;
  gap: var(--space-3);
  align-items: start;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

.eight__n {
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  color: var(--color-gold-300);
  font-size: var(--text-xs);
}
</style>
