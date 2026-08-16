<script setup lang="ts">
import { computed } from "vue";
import type { CharacterProfileView } from "../../api/types";
import { DIMENSION_LABELS, formatScore, formatWeight, type RadarDimension } from "../../lib/format";

const props = defineProps<{
  profile: CharacterProfileView;
}>();

const calc = computed(() => props.profile.scoreCalculation ?? null);
const rows = computed(() => calc.value?.components ?? []);
const mix = computed(() => calc.value?.performanceMix ?? null);
const roleAware = computed(() => props.profile.performanceSummary?.roleAware ?? null);
const overall = computed(() => props.profile.score?.overallScore ?? null);

const showInternalFormula = computed(() => {
  const formula = calc.value?.overallFormula;
  if (!formula) return false;
  return formula !== "WEIGHTED_DIMENSIONS";
});

const healerMixRows = computed(() => {
  if (!mix.value || roleAware.value?.role !== "HEALER") return [];
  return [
    {
      label: "Healing performance",
      score: roleAware.value.healing?.score ?? null,
      weight: mix.value.healingParse,
    },
    {
      label: "Damage performance",
      score: roleAware.value.damage.score,
      weight: mix.value.damageParse,
    },
  ].filter((row) => row.weight > 0);
});
</script>

<template>
  <section class="methodology" aria-labelledby="methodology-title" data-testid="methodology-panel">
    <h2 id="methodology-title">Methodology &amp; calculation</h2>
    <details class="panel">
      <summary>How this score was calculated</summary>
      <div class="panel__body">
        <h3 v-if="calc?.role">
          Performance{{ calc.role === "HEALER" ? " — Healer" : calc.role === "TANK" ? " — Tank" : " — Damage" }}
        </h3>
        <p v-if="showInternalFormula" class="muted mpts-data">{{ calc?.overallFormula }}</p>

        <div v-if="healerMixRows.length" class="table-wrap" data-testid="performance-mix">
          <table>
            <tbody>
              <tr v-for="row in healerMixRows" :key="row.label">
                <th scope="row">{{ row.label }}</th>
                <td class="mpts-data">{{ formatScore(row.score, 0) }}</td>
                <td class="mpts-data">{{ formatWeight(row.weight) }}</td>
              </tr>
              <tr v-if="roleAware?.performanceScore != null">
                <th scope="row">Result</th>
                <td class="mpts-data" colspan="2">{{ formatScore(roleAware.performanceScore, 0) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="rows.length" class="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Component</th>
                <th scope="col">Score</th>
                <th scope="col">Weight</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in rows" :key="row.key">
                <td>{{ DIMENSION_LABELS[row.key.toUpperCase() as RadarDimension] ?? row.label }}</td>
                <td class="mpts-data">{{ formatScore(row.score, 1) }}</td>
                <td class="mpts-data">{{ formatWeight(row.effectiveWeight) }}</td>
              </tr>
              <tr v-if="overall != null">
                <th scope="row">Trust Score</th>
                <td class="mpts-data" colspan="2">{{ formatScore(overall, 0) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="!rows.length" class="muted">Calculation breakdown is not available for this snapshot.</p>
      </div>
    </details>
  </section>
</template>

<style scoped>
.methodology {
  display: grid;
  gap: var(--space-3);
}
.methodology h2 {
  margin: 0;
}
.methodology h3 {
  margin: 0;
  font-size: var(--text-sm);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}
.muted {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
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
}
.panel__body {
  display: grid;
  gap: var(--space-4);
  padding-bottom: var(--space-4);
}
.table-wrap {
  overflow-x: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
}
th, td {
  text-align: left;
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--color-border);
}
</style>
