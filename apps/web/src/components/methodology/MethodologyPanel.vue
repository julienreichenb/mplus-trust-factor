<script setup lang="ts">
import { computed } from "vue";
import type { CharacterProfileView } from "../../api/types";
import { DIMENSION_LABELS, formatPercent, formatScore, formatWeight, type RadarDimension } from "../../lib/format";
import { explanationSummary } from "../../lib/characterViewModel";

const props = defineProps<{
  profile: CharacterProfileView;
}>();

const score = computed(() => props.profile.score);
const summary = computed(() => explanationSummary(score.value));

const weightRows = computed(() =>
  (score.value?.dimensions ?? [])
    .filter((d) => d.dimension !== "AUTHENTICITY")
    .map((d) => ({
      label: DIMENSION_LABELS[d.dimension as RadarDimension] ?? d.dimension,
      weight: d.weight,
      score: d.score,
      confidence: d.confidence,
    })),
);
</script>

<template>
  <section class="methodology" aria-labelledby="methodology-title" data-testid="methodology-panel">
    <h2 id="methodology-title">Methodology & calculation</h2>
    <p class="lede">
      Concise model metadata for this snapshot. Essential warnings about missing or stale data remain
      visible above; this section adds calculation detail on demand.
    </p>

    <details class="panel">
      <summary>View model version, weights and limitations</summary>

      <div class="panel__body">
        <dl class="meta">
          <div>
            <dt>Model</dt>
            <dd class="mpts-data">{{ score?.modelKey ?? "Unavailable" }} v{{ score?.modelVersion ?? "—" }}</dd>
          </div>
          <div>
            <dt>Calculated</dt>
            <dd class="mpts-data">
              {{ score?.calculatedAt ? new Date(score.calculatedAt).toLocaleString() : "Unavailable" }}
            </dd>
          </div>
          <div>
            <dt>Season</dt>
            <dd class="mpts-data">{{ score?.seasonSlug ?? "Unavailable" }}</dd>
          </div>
          <div>
            <dt>Fingerprint</dt>
            <dd class="mpts-data">{{ score?.inputFingerprint ?? "Unavailable" }}</dd>
          </div>
        </dl>

        <p v-if="summary" class="summary">{{ summary }}</p>

        <div v-if="weightRows.length" class="weights">
          <h3>Dimension weights in this snapshot</h3>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Dimension</th>
                  <th scope="col">Weight</th>
                  <th scope="col">Score</th>
                  <th scope="col">Confidence</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in weightRows" :key="row.label">
                  <td>{{ row.label }}</td>
                  <td class="mpts-data">{{ formatWeight(row.weight) }}</td>
                  <td class="mpts-data">{{ formatScore(row.score, 0) }}</td>
                  <td class="mpts-data">{{ formatPercent(row.confidence * 100, 0) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <p v-else class="muted">Dimension weights are not present in this response.</p>

        <p class="muted">
          Grade thresholds and the global equation are not included in the character payload. They remain
          unavailable here rather than hard-coded from documentation.
        </p>
        <p class="muted">
          Limitations: confidence shrinkage, provider gaps and probabilistic authenticity signals can move
          a result without implying player intent.
        </p>
      </div>
    </details>
  </section>
</template>

<style scoped>
.methodology {
  display: grid;
  gap: var(--space-3);
}

.methodology h2,
.methodology h3 {
  margin: 0;
}

.lede,
.muted,
.summary {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

.summary {
  color: var(--color-text);
}

.panel {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  background: var(--color-surface);
  padding: 0 var(--space-4);
}

.panel summary {
  cursor: pointer;
  font-weight: 600;
  padding: var(--space-4) 0;
  list-style-position: outside;
}

.panel__body {
  display: grid;
  gap: var(--space-4);
  padding-bottom: var(--space-4);
}

.meta {
  display: grid;
  gap: var(--space-3);
  margin: 0;
  grid-template-columns: 1fr;
}

.meta dt {
  font-size: var(--text-xs);
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.meta dd {
  margin: var(--space-1) 0 0;
  overflow-wrap: anywhere;
}

.table-wrap {
  overflow-x: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
}

th,
td {
  text-align: left;
  padding: 0.45rem 0.5rem;
  border-bottom: 1px solid var(--color-border);
}

th {
  color: var(--color-text-muted);
  font-weight: 600;
}

@media (min-width: 768px) {
  .meta {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
