<script setup lang="ts">
import { formatContextFactor } from "../../lib/scoreContextFormat";

defineProps<{
  rows: Array<{
    percentileBps: number;
    percentileLabel: string | null;
    factor: number;
    thresholds: { EU: number | null; US: number | null; KR: number | null; TW: number | null };
  }>;
  unavailable: boolean;
  readOnly: boolean;
}>();

const emit = defineEmits<{
  "update-factor": [percentileBps: number, factor: number];
}>();

function formatKey(threshold: number | null): string {
  if (threshold == null || !Number.isFinite(threshold)) return "—";
  return `+${threshold}`;
}
</script>

<template>
  <div class="key-tab" data-testid="key-tab-panel">
    <p v-if="unavailable" class="warn" data-testid="missing-distribution">
      Key difficulty distribution unavailable for this season.
    </p>
    <div v-else class="key-table-wrap">
      <table class="key-table" data-testid="anchor-table">
        <thead>
          <tr>
            <th>Percentile</th>
            <th>EU</th>
            <th>US</th>
            <th>KR</th>
            <th>TW</th>
            <th>Factor</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.percentileBps" :data-testid="`key-row-${row.percentileBps}`">
            <td>
              <span data-testid="key-percentile-label">{{ row.percentileLabel ?? "—" }}</span>
            </td>
            <td v-for="region in (['EU', 'US', 'KR', 'TW'] as const)" :key="region">
              <span :data-testid="`anchor-threshold-${region}`">{{ formatKey(row.thresholds[region]) }}</span>
            </td>
            <td>
              <span v-if="readOnly" class="factor-value" :data-testid="`key-factor-${row.percentileBps}`">
                {{ formatContextFactor(row.factor) }}
              </span>
              <label v-else class="factor">
                <span class="muted">×</span>
                <input
                  :value="row.factor"
                  type="number"
                  min="0.01"
                  step="0.01"
                  :data-testid="`key-factor-${row.percentileBps}`"
                  @change="
                    emit('update-factor', row.percentileBps, Number(($event.target as HTMLInputElement).value))
                  "
                />
              </label>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.warn {
  color: #f0c674;
}
.key-table-wrap {
  overflow-x: auto;
  max-width: 100%;
}
.key-table {
  width: 100%;
  min-width: 28rem;
  border-collapse: collapse;
  font-variant-numeric: tabular-nums;
}
.key-table th,
.key-table td {
  text-align: left;
  padding: 0.55rem 0.75rem;
  border-bottom: 1px solid rgb(255 255 255 / 12%);
}
.key-table th {
  color: var(--color-text-muted);
  font-weight: 600;
  font-size: var(--text-sm);
}
.factor {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}
.factor input {
  width: 5.5rem;
}
.factor-value {
  font-weight: 600;
}
.muted {
  color: var(--color-text-muted);
}
</style>
