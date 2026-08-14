<script setup lang="ts">
defineProps<{
  rows: Array<{
    percentileBps: number;
    percentileLabel: string | null;
    medianKeyThreshold: number | null;
    factor: number;
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
    <table v-else class="key-table" data-testid="anchor-table">
      <thead>
        <tr>
          <th>Percentile</th>
          <th>Season median key</th>
          <th>Factor</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.percentileBps" :data-testid="`key-row-${row.percentileBps}`">
          <td>
            <span data-testid="key-percentile-label">{{ row.percentileLabel ?? "—" }}</span>
            <input
              class="sr-only"
              :value="row.percentileLabel"
              readonly
              tabindex="-1"
              data-testid="key-percentile-readonly"
            />
          </td>
          <td>
            <span data-testid="anchor-threshold">{{ formatKey(row.medianKeyThreshold) }}</span>
            <input
              class="sr-only"
              :value="formatKey(row.medianKeyThreshold)"
              readonly
              tabindex="-1"
              data-testid="key-threshold-readonly"
            />
          </td>
          <td>
            <label class="factor">
              <span class="muted">×</span>
              <input
                :value="row.factor"
                type="number"
                min="0.01"
                step="0.01"
                :disabled="readOnly"
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
</template>

<style scoped>
.warn {
  color: #f0c674;
}
.key-table {
  width: 100%;
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
.muted {
  color: var(--color-text-muted);
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  border: 0;
}
</style>
