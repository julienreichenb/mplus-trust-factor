<script setup lang="ts">
const principles = [
  {
    title: "Explainable",
    body: "Tiers map to scored dimensions with visible rationale, not opaque rankings.",
  },
  {
    title: "Multi-dimensional",
    body: "No single metric decides trust — performance, consistency and evidence quality all contribute.",
  },
  {
    title: "Versioned",
    body: "Scores carry a model key and version so results remain comparable over time.",
  },
  {
    title: "Freshness-aware",
    body: "Source timestamps and refresh state stay attached to the result.",
  },
  {
    title: "Confidence-aware",
    body: "Incomplete or thin evidence is surfaced instead of silently overconfident tiers.",
  },
] as const;

const providers = [
  {
    name: "Blizzard APIs",
    status: "Implemented in the API layer",
    note: "Character, equipment and related profile signals when the live mode is configured.",
  },
  {
    name: "Raider.IO",
    status: "Used when attributed",
    note: "Public Mythic+ context with required attribution on character results.",
  },
  {
    name: "Warcraft Logs",
    status: "Used when available",
    note: "Performance signals when visibility and data allow.",
  },
] as const;
</script>

<template>
  <section id="methodology" class="methodology" aria-labelledby="methodology-title">
    <header class="methodology__header">
      <p class="eyebrow">Methodology</p>
      <h2 id="methodology-title">Transparent by design</h2>
      <p>
        M+ Trust Factor is an evidence panel for high-key screening. The landing preview shows the
        intended explainability surface; live character pages already expose score, confidence,
        freshness and source attribution from the current API contracts.
      </p>
    </header>

    <div class="methodology__panel">
      <pre class="equation mpts-data" aria-label="Conceptual scoring equation">
TrustFactor = f(dimensions, weights, evidenceCompleteness)
Tier ∈ {S, A, B, C, D}
      </pre>
      <p class="equation-note">
        Conceptual model only. Exact weights and thresholds ship with the active score model version
        on character results.
      </p>

      <ul class="principles">
        <li v-for="item in principles" :key="item.title">
          <h3>{{ item.title }}</h3>
          <p>{{ item.body }}</p>
        </li>
      </ul>
    </div>

    <div class="sources" aria-labelledby="sources-heading">
      <h3 id="sources-heading">Data providers in this architecture</h3>
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
        The visible API mode indicator shows whether this build is running against mock fixtures or a
        live backend. Fixture mode does not claim live World of Warcraft data.
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

.equation {
  margin: 0;
  padding: var(--space-4);
  border-radius: var(--radius-control);
  border: 1px solid var(--color-border);
  background: var(--color-obsidian-900);
  color: var(--color-gold-300);
  font-size: var(--text-sm);
  white-space: pre-wrap;
  overflow-x: auto;
}

.equation-note {
  margin: 0;
  font-size: var(--text-sm);
}

.principles {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-4);
}

.principles h3 {
  margin: 0 0 var(--space-1);
  color: var(--color-text);
}

.principles p {
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

@media (min-width: 768px) {
  .principles {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-5) var(--space-6);
  }
}

@media (min-width: 1024px) {
  .principles {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
</style>
