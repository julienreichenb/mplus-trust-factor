<script setup lang="ts">
import { computed } from "vue";
import type { PerformanceSummaryDTO } from "@mplus/contracts";

const props = defineProps<{
  summary: PerformanceSummaryDTO | null | undefined;
  locked?: boolean;
}>();

const current = computed(() => props.summary?.currentSeason ?? null);
const historical = computed(() => props.summary?.historical ?? null);

function formatPct(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${value.toFixed(1)}%`;
}

function runLabel(
  run: NonNullable<NonNullable<PerformanceSummaryDTO["currentSeason"]>["dungeons"][number]["bestRun"]>,
): string {
  const when = new Date(run.completedAt).toLocaleDateString();
  return `+${run.keyLevel} · ${when}${run.kind === "BOTH" ? " · best & latest" : ""}`;
}
</script>

<template>
  <section
    class="perf"
    aria-labelledby="perf-title"
    data-testid="performance-summary"
  >
    <h2 id="perf-title">Current-season performance</h2>
    <p class="lede">
      Equal-weighted Warcraft Logs Best % and Median % by dungeon. Missing dungeons lower confidence
      only — they are never scored as zero.
    </p>

    <p v-if="locked" class="locked">Details unlock with entitlements.</p>
    <template v-else-if="!current || current.dungeonCount === 0">
      <p class="empty" data-testid="performance-summary-empty">
        No current-season WCL percentile data is available for this character.
      </p>
    </template>
    <template v-else>
      <dl class="stats">
        <div>
          <dt>Peak</dt>
          <dd class="mpts-data">{{ formatPct(current.peakScore) }}</dd>
        </div>
        <div>
          <dt>Consistency</dt>
          <dd class="mpts-data">{{ formatPct(current.consistencyScore) }}</dd>
        </div>
        <div>
          <dt>Score</dt>
          <dd class="mpts-data">{{ formatPct(current.score) }}</dd>
        </div>
        <div>
          <dt>Coverage</dt>
          <dd class="mpts-data">
            {{ current.dungeonCount }}/{{ current.expectedDungeonCount }} dungeons
          </dd>
        </div>
      </dl>

      <div class="table-wrap">
        <table>
          <caption class="sr-only">Per-dungeon Best and Median parse percentiles</caption>
          <thead>
            <tr>
              <th scope="col">Dungeon</th>
              <th scope="col">Best %</th>
              <th scope="col">Median %</th>
              <th scope="col">Logs</th>
              <th scope="col">Selected runs</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="d in current.dungeons" :key="d.dungeonSlug">
              <th scope="row">{{ d.dungeonName }}</th>
              <td class="mpts-data">{{ formatPct(d.bestParsePercentile) }}</td>
              <td class="mpts-data">{{ formatPct(d.medianParsePercentile) }}</td>
              <td class="mpts-data">{{ d.loggedRunCount }}</td>
              <td>
                <template v-if="d.bestRun && (!d.latestRun || d.bestRun.runId === d.latestRun.runId)">
                  {{ runLabel(d.bestRun) }}
                </template>
                <template v-else>
                  <span v-if="d.bestRun">Best: {{ runLabel(d.bestRun) }}</span>
                  <span v-if="d.bestRun && d.latestRun"> · </span>
                  <span v-if="d.latestRun">Latest: {{ runLabel(d.latestRun) }}</span>
                  <span v-if="!d.bestRun && !d.latestRun">—</span>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p v-if="historical" class="hist mpts-data">
        Historical best-average ({{ historical.seasonsUsed }} season{{
          historical.seasonsUsed === 1 ? "" : "s"
        }}): {{ formatPct(historical.score) }}
      </p>
    </template>
  </section>
</template>

<style scoped>
.perf {
  display: grid;
  gap: var(--space-4);
}

.lede,
.empty,
.locked,
.hist {
  margin: 0;
  color: var(--color-text-muted);
  max-width: 68ch;
}

.stats {
  display: grid;
  gap: var(--space-3);
  margin: 0;
  grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
}

.stats div {
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  background: var(--color-surface);
}

.stats dt {
  font-size: var(--text-xs);
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.stats dd {
  margin: var(--space-1) 0 0;
  font-weight: 600;
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
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--color-border);
  vertical-align: top;
}
</style>
