<script setup lang="ts">
import { computed } from "vue";
import type { DimensionScoreDTO } from "@mplus/contracts";
import { formatPercent, formatScore, formatWeight } from "../../lib/format";
import { dimensionRows } from "../../lib/characterViewModel";

const props = defineProps<{
  dimensions: DimensionScoreDTO[];
  locked?: boolean;
}>();

const rows = computed(() => dimensionRows(props.dimensions));
</script>

<template>
  <section class="dim-table" aria-labelledby="dim-table-title" data-testid="dimension-table">
    <h3 id="dim-table-title">Exact dimension values</h3>
    <p v-if="locked" class="muted">Detailed dimension breakdown is locked by entitlement.</p>
    <div v-else class="table-wrap">
      <table>
        <caption class="sr-only">
          Trust dimension scores with confidence and weights
        </caption>
        <thead>
          <tr>
            <th scope="col">Dimension</th>
            <th scope="col">Score</th>
            <th scope="col">Confidence</th>
            <th scope="col">Weight</th>
            <th scope="col">State</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.dimension" :data-missing="row.missing ? 'true' : 'false'">
            <th scope="row">{{ row.label }}</th>
            <td class="mpts-data">{{ row.missing ? "—" : formatScore(row.score, 0) }}</td>
            <td class="mpts-data">
              {{ row.missing || row.confidence == null ? "—" : formatPercent(row.confidence * 100, 0) }}
            </td>
            <td class="mpts-data">
              {{ row.missing || row.weight == null ? "—" : formatWeight(row.weight) }}
            </td>
            <td>{{ row.missing ? "Missing" : "Present" }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.dim-table {
  display: grid;
  gap: var(--space-3);
}

.dim-table h3 {
  margin: 0;
  font-size: var(--text-base);
}

.muted {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

.table-wrap {
  overflow-x: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
  min-width: 28rem;
}

th,
td {
  text-align: left;
  padding: 0.5rem 0.55rem;
  border-bottom: 1px solid var(--color-border);
}

thead th {
  color: var(--color-text-muted);
  font-weight: 600;
}

tr[data-missing="true"] td,
tr[data-missing="true"] th {
  color: var(--color-text-muted);
  font-style: italic;
}
</style>
