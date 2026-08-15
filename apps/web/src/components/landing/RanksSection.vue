<script setup lang="ts">
import { formatWeight, type RadarDimension } from "../../lib/format";
import { GRADE_PROFILES, GRADE_RANGES, TRUST_GRADES } from "../../lib/trustGradeScale";
import DimensionAxisIcon from "../charts/DimensionAxisIcon.vue";
import TrustGradeLadder from "./TrustGradeLadder.vue";
import TrustTierBadge from "./TrustTierBadge.vue";

/** Current default model (v3) — keep in sync with packages/scoring/src/model/defaults.ts */
const DIMENSION_WEIGHTS: Array<{
  dimension: RadarDimension;
  label: string;
  weight: number;
  hint: string;
  detail: string;
}> = [
  {
    dimension: "PERFORMANCE",
    label: "Performance",
    weight: 0.35,
    hint: "How they perform in timed keys",
    detail:
      "Warcraft Logs parse percentiles for peak and consistency this season, plus contextual contribution in timed runs — not raw Raider.IO rating.",
  },
  {
    dimension: "SURVIVAL",
    label: "Survival",
    weight: 0.3,
    hint: "Staying alive under pressure",
    detail:
      "Death rate, avoidable damage, defensive usage, and recovery from dangerous moments observed in public combat logs.",
  },
  {
    dimension: "UTILITY",
    label: "Utility",
    weight: 0.25,
    hint: "How they help the group",
    detail:
      "Interrupts, crowd control, dispels, externals, and role-relevant kit usage tracked when log visibility allows.",
  },
  {
    dimension: "EXPERIENCE",
    label: "Experience",
    weight: 0.1,
    hint: "Breadth and progression",
    detail:
      "Key volume and recency, dungeon breadth, repeatability at level, and seasonal progression — including Raider.IO rating as a progression signal.",
  },
];
</script>

<template>
  <section id="how-it-works" class="ranks" aria-labelledby="ranks-title">
    <header class="ranks__header">
      <p class="eyebrow">Trust scoring</p>
      <h2 id="ranks-title">How it works</h2>
    </header>
    <p class="ranks__lede">
        Each profile is scored from 0 to 100 across four areas, weighted and combined into one trust
        score. That score maps to a letter grade — or U when there is not enough reliable data. Hover
        a badge for a quick read; expand below for the full breakdown.
    </p>

    <TrustGradeLadder />

    <details class="ranks__more">
      <summary class="ranks__more-summary">More details</summary>

      <div class="ranks__details">
        <article class="ranks__panel">
          <h3 class="ranks__panel-title">Dimension weights</h3>
          <p class="ranks__panel-lede">
            Scores use public Mythic+ and combat-log data where available. Each dimension aggregates
            several observable signals, normalizes them to 0–100, then blends into one trust score
            using the current model weights:
          </p>
          <ul class="ranks__weights">
            <li v-for="item in DIMENSION_WEIGHTS" :key="item.dimension">
              <div class="ranks__weight-copy">
                <div class="ranks__weight-head">
                  <span class="ranks__weight-icon" aria-hidden="true">
                    <DimensionAxisIcon layout="fill" :dimension="item.dimension" />
                  </span>
                  <span class="ranks__weight-label">{{ item.label }}</span>
                </div>
                <span class="ranks__weight-hint">{{ item.hint }}</span>
                <span class="ranks__weight-detail">{{ item.detail }}</span>
              </div>
              <span class="ranks__weight-value mpts-data">{{ formatWeight(item.weight) }}</span>
            </li>
          </ul>
          <p class="ranks__note">
            Dimensions without usable data are excluded from the blend — they never count as zero.
            Thin or stale evidence lowers confidence and can surface as U instead of a letter grade.
            Boost and carry patterns can also reduce the final score when authenticity signals fire.
          </p>
        </article>

        <article class="ranks__panel">
          <h3 class="ranks__panel-title">Grade scale</h3>
          <p class="ranks__panel-lede">
            Letter grades reflect the combined trust score on a 0–100 scale:
          </p>
          <div class="ranks__scale">
            <article v-for="grade in TRUST_GRADES" :key="grade" class="ranks__scale-row">
              <div class="ranks__scale-meta">
                <div class="ranks__scale-badge">
                  <TrustTierBadge :tier="grade" size="sm" letter-only flush />
                </div>
                <div class="ranks__scale-range">
                  <p class="ranks__scale-eyebrow">{{ GRADE_PROFILES[grade].title }}</p>
                  <span class="ranks__scale-score mpts-data">{{ GRADE_RANGES[grade] }}</span>
                </div>
              </div>
              <p class="ranks__scale-desc">{{ GRADE_PROFILES[grade].description }}</p>
            </article>
          </div>
        </article>
      </div>
    </details>
  </section>
</template>

<style scoped>
.ranks {
  display: grid;
  gap: var(--space-8);
}

.ranks__header {
  max-width: var(--container-reading);
}

.ranks__header p.eyebrow {
  margin: 0;
  font-family: var(--font-data);
  font-size: var(--text-xs);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-gold-300);
}

.ranks__header h2 {
  margin: 0 0 var(--space-3);
}

.ranks__lede {
  margin: 0;
  width: 100%;
  max-width: none;
  color: var(--color-text-muted);
  line-height: 1.45;
}

.ranks__more-summary {
  cursor: pointer;
  list-style: none;
  padding: 0;
  font-weight: 600;
  color: var(--color-text);
  user-select: none;
}

.ranks__more-summary::-webkit-details-marker {
  display: none;
}

.ranks__more-summary::before {
  content: "";
  display: inline-block;
  width: 0.45rem;
  height: 0.45rem;
  margin-right: var(--space-2);
  border-right: 1.5px solid var(--color-gold-300);
  border-bottom: 1.5px solid var(--color-gold-300);
  transform: rotate(-45deg);
  transition: transform var(--duration-fast);
  vertical-align: 0.1em;
}

.ranks__more[open] .ranks__more-summary::before {
  transform: rotate(45deg);
}

.ranks__details {
  display: grid;
  gap: var(--space-5);
  margin-top: var(--space-4);
}

.ranks__panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  height: 100%;
  padding: var(--space-6);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  background: var(--color-bg-elevated);
}

.ranks__panel-title {
  margin: 0;
  font-size: var(--text-base);
  color: var(--color-text);
}

.ranks__panel-lede {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  line-height: 1.45;
}

.ranks__weights {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-3);
  flex: 1;
}

.ranks__weights li {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
  padding-bottom: var(--space-3);
  border-bottom: 1px solid var(--color-border);
}

.ranks__weights li:last-child {
  padding-bottom: 0;
  border-bottom: none;
}

.ranks__weight-copy {
  display: grid;
  gap: 0.25rem;
  min-width: 0;
}

.ranks__weight-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.ranks__weight-icon {
  display: grid;
  place-items: center;
  color: var(--color-gold-300);
}

.ranks__weight-icon :deep(.dim-icon) {
  width: 1.25rem;
  height: 1.25rem;
}

.ranks__weight-label {
  font-weight: 600;
  color: var(--color-text);
}

.ranks__weight-hint {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-text);
  line-height: 1.35;
}

.ranks__weight-detail {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  line-height: 1.4;
}

.ranks__weight-value {
  flex-shrink: 0;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-gold-300);
}

.ranks__scale {
  display: grid;
  gap: var(--space-3);
  flex: 1;
}

.ranks__scale-row {
  display: grid;
  gap: var(--space-2);
  padding-bottom: var(--space-3);
  border-bottom: 1px solid var(--color-border);
}

.ranks__scale-row:last-child {
  padding-bottom: 0;
  border-bottom: none;
}

.ranks__scale-meta {
  display: flex;
  align-items: stretch;
  gap: var(--space-3);
}

.ranks__scale-badge {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.ranks__scale-range {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 0.15rem;
  min-width: 0;
}

.ranks__scale-eyebrow {
  margin: 0;
  font-family: var(--font-data);
  font-size: var(--text-xs);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-gold-300);
}

.ranks__scale-score {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-text);
  line-height: 1.2;
}

.ranks__scale-desc {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  line-height: 1.4;
}

.ranks__note {
  margin: auto 0 0;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  line-height: 1.45;
}

@media (min-width: 900px) {
  .ranks__details {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    align-items: stretch;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ranks__more-summary::before {
    transition: none;
  }
}
</style>
