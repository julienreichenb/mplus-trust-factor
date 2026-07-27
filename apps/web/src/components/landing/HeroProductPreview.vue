<script setup lang="ts">
import TrustTierBadge from "./TrustTierBadge.vue";
import { formatScore } from "../../lib/format";

/** Static presentation data for the landing product preview only — not live scoring. */
const preview = {
  name: "Examplepaladin",
  classSpec: "Protection Paladin · Tank",
  realm: "Example Realm · EU",
  score: 88,
  grade: "A" as const,
  confidence: 78,
  freshness: "Fresh snapshot",
  dimensions: [
    { key: "Performance", value: 91 },
    { key: "Survival", value: 84 },
    { key: "Utility", value: 86 },
    { key: "Experience", value: 80 },
  ],
  runs: [
    { dungeon: "Priory", key: 12, timed: true },
    { dungeon: "Rookery", key: 13, timed: true },
    { dungeon: "Floodgate", key: 12, timed: true },
    { dungeon: "Darkflame", key: 11, timed: true },
    { dungeon: "Cinderbrew", key: 12, timed: false },
    { dungeon: "Motherlode", key: 11, timed: true },
    { dungeon: "Theater", key: 12, timed: true },
    { dungeon: "Workshop", key: 10, timed: true },
  ],
};
</script>

<template>
  <aside class="preview" aria-labelledby="preview-title" data-testid="hero-product-preview">
    <div class="preview__banner">
      <p id="preview-title" class="preview__eyebrow">Product preview</p>
      <p class="preview__disclaimer">Illustrative layout — not a live character result.</p>
    </div>

    <div class="preview__compose">
      <div class="identity">
        <p class="identity__name">{{ preview.name }}</p>
        <p class="identity__meta">{{ preview.classSpec }}</p>
        <p class="identity__meta">{{ preview.realm }}</p>
      </div>

      <div class="score-block">
        <div class="score">
          <span class="score__label">Trust Factor</span>
          <span class="score__value mpts-data">{{ formatScore(preview.score, 0) }}</span>
          <span class="score__scale">/ 100</span>
        </div>
        <TrustTierBadge tier="A" label="Strong trust profile" size="lg" />
      </div>

      <dl class="meta-row">
        <div>
          <dt>Confidence</dt>
          <dd class="mpts-data">{{ preview.confidence }}%</dd>
        </div>
        <div>
          <dt>Freshness</dt>
          <dd>{{ preview.freshness }}</dd>
        </div>
        <div>
          <dt>Selected runs</dt>
          <dd class="mpts-data">8 / 8</dd>
        </div>
      </dl>

      <div class="dims" aria-label="Four trust dimensions">
        <div v-for="dim in preview.dimensions" :key="dim.key" class="dims__item">
          <span class="dims__label">{{ dim.key }}</span>
          <span class="dims__bar" aria-hidden="true">
            <span class="dims__fill" :style="{ width: `${dim.value}%` }" />
          </span>
          <span class="dims__value mpts-data">{{ dim.value }}</span>
        </div>
      </div>
      <table class="sr-only">
        <caption>Example dimension scores</caption>
        <thead>
          <tr>
            <th>Dimension</th>
            <th>Score</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="dim in preview.dimensions" :key="`t-${dim.key}`">
            <td>{{ dim.key }}</td>
            <td>{{ dim.value }}</td>
          </tr>
        </tbody>
      </table>

      <div class="runs">
        <p class="runs__label">Eight highest-key runs · one per dungeon</p>
        <ul class="runs__list">
          <li v-for="run in preview.runs" :key="run.dungeon">
            <span class="runs__dungeon">{{ run.dungeon }}</span>
            <span class="runs__key mpts-data">+{{ run.key }}</span>
            <span class="runs__timed">{{ run.timed ? "Timed" : "Deplete" }}</span>
          </li>
        </ul>
      </div>
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

.preview__compose {
  display: grid;
  gap: var(--space-5);
  padding: var(--space-5);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-hero);
  background:
    linear-gradient(165deg, rgb(245 158 11 / 5%), transparent 40%),
    var(--color-surface);
}

.identity__name {
  margin: 0;
  font-weight: 700;
  font-size: var(--text-lg);
  color: var(--color-text);
}

.identity__meta {
  margin: 0.15rem 0 0;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

.score-block {
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

.meta-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-3);
  margin: 0;
  padding: var(--space-3) 0;
  border-top: 1px solid var(--color-border);
  border-bottom: 1px solid var(--color-border);
}

.meta-row dt {
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-muted);
}

.meta-row dd {
  margin: var(--space-1) 0 0;
  font-size: var(--text-sm);
  color: var(--color-text);
}

.dims {
  display: grid;
  gap: var(--space-3);
}

.dims__item {
  display: grid;
  grid-template-columns: 7rem 1fr 2.5rem;
  gap: var(--space-3);
  align-items: center;
}

.dims__label {
  font-size: var(--text-sm);
  color: var(--color-text);
}

.dims__bar {
  height: 0.4rem;
  border-radius: var(--radius-control);
  background: var(--color-obsidian-900);
  overflow: hidden;
}

.dims__fill {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, var(--color-amber-600), var(--color-gold-300));
}

.dims__value {
  text-align: right;
  font-size: var(--text-sm);
  font-weight: 600;
}

.runs__label {
  margin: 0 0 var(--space-3);
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-text);
}

.runs__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-2);
  grid-template-columns: 1fr;
}

.runs__list li {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: var(--space-2);
  align-items: center;
  font-size: var(--text-sm);
  padding-top: var(--space-2);
  border-top: 1px solid rgb(52 52 58 / 70%);
}

.runs__dungeon {
  color: var(--color-text);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.runs__key {
  color: var(--color-gold-300);
  font-weight: 600;
}

.runs__timed {
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

@media (min-width: 480px) {
  .runs__list {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
