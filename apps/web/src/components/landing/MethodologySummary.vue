<script setup lang="ts">
const providers = [
  {
    name: "Blizzard APIs",
    status: "Identity, media, equipment, talents",
    note: "Character identity and paperdoll when live mode is configured.",
  },
  {
    name: "Raider.IO",
    status: "Season runs and rating context",
    note: "Public Mythic+ context with required attribution on results.",
  },
  {
    name: "Warcraft Logs",
    status: "Execution evidence when matched",
    note: "Parses and combat facts when visibility and matching allow.",
  },
] as const;

const flow = [
  "Resolve active season and fuse canonical runs.",
  "Select one highest-key run per dungeon.",
  "Score dimensions from that shared set.",
  "Publish Trust Factor with confidence and gaps.",
] as const;
</script>

<template>
  <section id="methodology" class="methodology" aria-labelledby="methodology-title">
    <header class="methodology__header">
      <p class="eyebrow">Provenance & methodology</p>
      <h2 id="methodology-title">Transparent by design</h2>
      <p>
        Providers stay named. Missing matches stay missing. Model key and version travel with every
        score so results remain inspectable.
      </p>
    </header>

    <div class="methodology__panel">
      <ol class="flow">
        <li v-for="(step, index) in flow" :key="step">
          <span class="flow__n mpts-data">{{ index + 1 }}</span>
          <span>{{ step }}</span>
        </li>
      </ol>
      <p class="equation-note">
        Exact weights ship with the active score model on character results. The frontend never
        recalculates Trust Factor.
      </p>
    </div>

    <div class="sources" aria-labelledby="sources-heading">
      <h3 id="sources-heading">Data providers</h3>
      <ul>
        <li v-for="provider in providers" :key="provider.name">
          <div class="sources__head">
            <strong>{{ provider.name }}</strong>
            <span class="sources__status">{{ provider.status }}</span>
          </div>
          <p>{{ provider.note }}</p>
        </li>
      </ul>
      <p class="mode-note">
        The API mode indicator shows whether this build uses mock fixtures or a live backend.
      </p>
    </div>
  </section>
</template>

<style scoped>
.methodology {
  display: grid;
  gap: var(--space-8);
}

.methodology__header {
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

.methodology__header h2 {
  margin: 0 0 var(--space-3);
}

.methodology__header p {
  margin: 0;
}

.methodology__panel {
  display: grid;
  gap: var(--space-5);
  padding: var(--space-6);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  background: var(--color-surface);
}

.flow {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-3);
}

.flow li {
  display: grid;
  grid-template-columns: 2rem 1fr;
  gap: var(--space-3);
  align-items: start;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

.flow__n {
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  color: var(--color-gold-300);
  font-size: var(--text-xs);
}

.equation-note {
  margin: 0;
  font-size: var(--text-sm);
}

.sources h3 {
  margin: 0 0 var(--space-4);
}

.sources ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-4);
}

.sources li {
  padding-bottom: var(--space-4);
  border-bottom: 1px solid var(--color-border);
}

.sources__head {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-3);
  align-items: baseline;
  margin-bottom: var(--space-2);
}

.sources__status {
  font-family: var(--font-data);
  font-size: var(--text-xs);
  color: var(--color-brand);
}

.sources p,
.mode-note {
  margin: 0;
  font-size: var(--text-sm);
}

.mode-note {
  margin-top: var(--space-5);
  color: var(--color-text-muted);
}
</style>
