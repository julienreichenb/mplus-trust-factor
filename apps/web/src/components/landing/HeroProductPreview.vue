<script setup lang="ts">
import TrustTierBadge from "./TrustTierBadge.vue";

/** Static presentation data for the landing product preview only. */
const preview = {
  name: "Examplepaladin",
  classSpec: "Protection Paladin",
  realm: "Example Realm · EU",
  guild: "<Demo Guild>",
  score: 88,
  evidence: "91%",
  model: "demo-preview · v0",
  updated: "Preview only",
  dimensions: [
    { key: "Experience", value: 82 },
    { key: "Performance", value: 91 },
    { key: "Consistency", value: 76 },
    { key: "Preparedness", value: 84 },
    { key: "Evidence quality", value: 88 },
  ],
  signals: {
    positive: ["Timed high-key volume", "Stable parse band"],
    risks: ["Limited recent season sample", "One stale source window"],
  },
  slots: ["Head", "Neck", "Shoulders", "Back", "Chest", "Wrist", "Hands", "Waist", "Legs", "Feet"],
  sources: [
    { name: "Blizzard", state: "Available in API modes" },
    { name: "Raider.IO", state: "When attributed" },
    { name: "Warcraft Logs", state: "When available" },
  ],
};

function radarPoint(index: number, total: number, value: number): string {
  const angle = (-Math.PI / 2) + (index / total) * Math.PI * 2;
  const radius = 18 + (value / 100) * 28;
  const x = 50 + Math.cos(angle) * radius;
  const y = 50 + Math.sin(angle) * radius;
  return `${x.toFixed(1)},${y.toFixed(1)}`;
}

const radarPolygon = preview.dimensions
  .map((d, i) => radarPoint(i, preview.dimensions.length, d.value))
  .join(" ");

const radarRing = preview.dimensions
  .map((_, i) => radarPoint(i, preview.dimensions.length, 100))
  .join(" ");
</script>

<template>
  <aside class="preview" aria-labelledby="preview-title">
    <div class="preview__banner">
      <p id="preview-title" class="preview__eyebrow">Product preview</p>
      <p class="preview__disclaimer">
        Illustrative layout only — not a live character result.
      </p>
    </div>

    <div class="preview__card">
      <div class="identity">
        <div class="avatar" aria-hidden="true">
          <span class="avatar__silhouette" />
        </div>
        <div class="identity__text">
          <p class="identity__name">{{ preview.name }}</p>
          <p class="identity__meta">{{ preview.classSpec }}</p>
          <p class="identity__meta">{{ preview.realm }} · {{ preview.guild }}</p>
        </div>
      </div>

      <div class="score-row">
        <div class="score">
          <span class="score__label">M+ Trust Factor</span>
          <span class="score__value mpts-data">{{ preview.score }}</span>
          <span class="score__scale">/ 100</span>
        </div>
        <TrustTierBadge tier="A" label="Strong trust profile" size="lg" />
      </div>

      <dl class="metrics">
        <div>
          <dt>Evidence</dt>
          <dd class="mpts-data">{{ preview.evidence }}</dd>
        </div>
        <div>
          <dt>Model</dt>
          <dd class="mpts-data">{{ preview.model }}</dd>
        </div>
        <div>
          <dt>Freshness</dt>
          <dd>{{ preview.updated }}</dd>
        </div>
      </dl>

      <div class="breakdown">
        <div class="radar" aria-hidden="true">
          <svg viewBox="0 0 100 100" role="presentation">
            <polygon class="radar__ring" :points="radarRing" />
            <polygon class="radar__fill" :points="radarPolygon" />
          </svg>
          <p class="radar__caption">Score breakdown</p>
        </div>
        <table class="dim-table">
          <caption class="sr-only">Example score dimensions for the product preview</caption>
          <thead>
            <tr>
              <th scope="col">Dimension</th>
              <th scope="col">Score</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="dim in preview.dimensions" :key="dim.key">
              <td>{{ dim.key }}</td>
              <td class="mpts-data">{{ dim.value }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="signals">
        <div>
          <h3>Positive signals</h3>
          <ul>
            <li v-for="item in preview.signals.positive" :key="item">{{ item }}</li>
          </ul>
        </div>
        <div>
          <h3>Limitations</h3>
          <ul>
            <li v-for="item in preview.signals.risks" :key="item">{{ item }}</li>
          </ul>
        </div>
      </div>

      <div class="gear" aria-label="Example equipment placeholders">
        <p class="gear__label">Equipped slots <span class="gear__note">(placeholders)</span></p>
        <ul class="gear__slots">
          <li v-for="slot in preview.slots" :key="slot" :title="slot">
            <span class="sr-only">{{ slot }}</span>
          </li>
        </ul>
      </div>

      <ul class="sources">
        <li v-for="source in preview.sources" :key="source.name">
          <span class="sources__name">{{ source.name }}</span>
          <span class="sources__state">{{ source.state }}</span>
        </li>
      </ul>
    </div>
  </aside>
</template>

<style scoped>
.preview {
  display: grid;
  gap: var(--space-3);
}

.preview__banner {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-4);
  align-items: baseline;
  justify-content: space-between;
}

.preview__eyebrow {
  margin: 0;
  font-family: var(--font-data);
  font-size: var(--text-xs);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-gold-300);
}

.preview__disclaimer {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

.preview__card {
  display: grid;
  gap: var(--space-5);
  padding: var(--space-5);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-hero);
  background:
    linear-gradient(160deg, rgb(245 158 11 / 6%), transparent 42%),
    var(--color-surface);
  box-shadow: 0 0 0 1px rgb(244 213 141 / 4%), var(--shadow-brand-glow);
}

.identity {
  display: flex;
  gap: var(--space-4);
  align-items: center;
}

.avatar {
  width: 4rem;
  height: 4rem;
  border-radius: 50%;
  border: 1px solid rgb(244 213 141 / 35%);
  background:
    radial-gradient(circle at 35% 30%, rgb(244 213 141 / 35%), transparent 45%),
    linear-gradient(145deg, var(--color-iron-800), var(--color-obsidian-950));
  display: grid;
  place-items: center;
  flex-shrink: 0;
}

.avatar__silhouette {
  width: 1.75rem;
  height: 2.1rem;
  border-radius: 40% 40% 35% 35%;
  background: rgb(241 233 219 / 28%);
  clip-path: polygon(50% 0%, 85% 18%, 78% 55%, 90% 100%, 10% 100%, 22% 55%, 15% 18%);
}

.identity__name {
  margin: 0;
  font-weight: 700;
  color: var(--color-text);
}

.identity__meta {
  margin: 0.15rem 0 0;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

.score-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  align-items: center;
  justify-content: space-between;
}

.score__label {
  display: block;
  font-size: var(--text-xs);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.score__value {
  font-size: clamp(2.5rem, 5vw, 3.5rem);
  font-weight: 600;
  line-height: 1;
  color: var(--color-gold-300);
}

.score__scale {
  font-family: var(--font-data);
  color: var(--color-text-muted);
  margin-left: var(--space-1);
}

.metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-3);
  margin: 0;
  padding: var(--space-3) 0;
  border-top: 1px solid var(--color-border);
  border-bottom: 1px solid var(--color-border);
}

.metrics dt {
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-muted);
}

.metrics dd {
  margin: var(--space-1) 0 0;
  font-size: var(--text-sm);
  color: var(--color-text);
}

.breakdown {
  display: grid;
  gap: var(--space-4);
}

.radar {
  display: grid;
  justify-items: center;
  gap: var(--space-2);
}

.radar svg {
  width: min(100%, 11rem);
  aspect-ratio: 1;
}

.radar__ring {
  fill: none;
  stroke: var(--color-border);
  stroke-width: 1;
}

.radar__fill {
  fill: rgb(245 158 11 / 14%);
  stroke: var(--color-amber-500);
  stroke-width: 1.5;
}

.radar__caption {
  margin: 0;
  font-size: var(--text-xs);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.dim-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
}

.dim-table th,
.dim-table td {
  text-align: left;
  padding: 0.4rem 0;
  border-bottom: 1px solid rgb(52 52 58 / 70%);
}

.dim-table th {
  color: var(--color-text-muted);
  font-weight: 600;
}

.dim-table td:last-child,
.dim-table th:last-child {
  text-align: right;
}

.signals {
  display: grid;
  gap: var(--space-4);
}

.signals h3 {
  margin: 0 0 var(--space-2);
  font-size: var(--text-sm);
  color: var(--color-text);
}

.signals ul {
  margin: 0;
  padding-left: 1.1rem;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
  display: grid;
  gap: var(--space-1);
}

.gear__label {
  margin: 0 0 var(--space-3);
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-text);
}

.gear__note {
  font-weight: 400;
  color: var(--color-text-muted);
}

.gear__slots {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: var(--space-2);
}

.gear__slots li {
  aspect-ratio: 1;
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-control);
  background: linear-gradient(145deg, var(--color-iron-800), var(--color-obsidian-950));
}

.sources {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-2);
}

.sources li {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
  font-size: var(--text-sm);
  padding-top: var(--space-2);
  border-top: 1px solid rgb(52 52 58 / 70%);
}

.sources__name {
  font-weight: 600;
  color: var(--color-text);
}

.sources__state {
  color: var(--color-text-muted);
  text-align: right;
}

@media (min-width: 480px) {
  .breakdown {
    grid-template-columns: auto 1fr;
    align-items: center;
  }

  .signals {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
