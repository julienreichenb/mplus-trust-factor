<script setup lang="ts">
import { computed } from "vue";
import type { PerformanceSummaryDTO } from "@mplus/contracts";

const props = defineProps<{
  summary: PerformanceSummaryDTO | null | undefined;
  locked?: boolean;
  /** When true, omit the section heading (parent owns the title). */
  embedded?: boolean;
}>();

const current = computed(() => props.summary?.currentSeason ?? null);
const historical = computed(() => props.summary?.historical ?? null);

const STAT_TOOLTIPS = {
  peak:
    "Equal-weighted average of Warcraft Logs Best % (peak parse) across current-season dungeons. Measures ceiling execution.",
  consistency:
    "Equal-weighted average of Warcraft Logs Median % across current-season dungeons. Measures typical execution, not the best pull.",
  score:
    "Current-season performance blend: 65% Peak + 35% Consistency. Missing dungeons are omitted from the average — never scored as zero.",
  coverage:
    "How many of the expected season dungeons have usable WCL percentile data. Lower coverage reduces confidence, not the score itself.",
} as const;

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
    :class="{ 'perf--embedded': embedded }"
    :aria-labelledby="embedded ? undefined : 'perf-title'"
    :aria-label="embedded ? 'Per-dungeon Warcraft Logs performance' : undefined"
    data-testid="performance-summary"
  >
    <template v-if="!embedded">
      <h2 id="perf-title">Current-season performance</h2>
    </template>

    <p v-if="locked" class="locked">Details unlock with entitlements.</p>
    <template v-else-if="!current || current.dungeonCount === 0">
      <p class="empty" data-testid="performance-summary-empty">
        No current-season WCL percentile data is available for this character.
      </p>
    </template>
    <template v-else>
      <dl class="cards">
        <div class="card" tabindex="0">
          <dt>Peak</dt>
          <dd class="mpts-data">{{ formatPct(current.peakScore) }}</dd>
          <span class="card__tip" role="tooltip">{{ STAT_TOOLTIPS.peak }}</span>
        </div>
        <div class="card" tabindex="0">
          <dt>Consistency</dt>
          <dd class="mpts-data">{{ formatPct(current.consistencyScore) }}</dd>
          <span class="card__tip" role="tooltip">{{ STAT_TOOLTIPS.consistency }}</span>
        </div>
        <div class="card" tabindex="0">
          <dt>Score</dt>
          <dd class="mpts-data">{{ formatPct(current.score) }}</dd>
          <span class="card__tip" role="tooltip">{{ STAT_TOOLTIPS.score }}</span>
        </div>
        <div class="card" tabindex="0">
          <dt>Coverage</dt>
          <dd class="mpts-data">
            {{ current.dungeonCount }}/{{ current.expectedDungeonCount }} dungeons
          </dd>
          <span class="card__tip" role="tooltip">{{ STAT_TOOLTIPS.coverage }}</span>
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

.empty,
.locked,
.hist {
  margin: 0;
  color: var(--color-text-muted);
  max-width: none;
}

.cards {
  display: grid;
  gap: var(--space-3);
  margin: 0;
  grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
}

.card {
  position: relative;
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  background: var(--color-surface);
  outline: none;
}

.card:hover,
.card:focus-visible {
  border-color: color-mix(in srgb, var(--color-gold-300) 55%, var(--color-border));
}

.card dt {
  font-size: var(--text-xs);
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.card dd {
  margin: var(--space-1) 0 0;
  font-weight: 600;
}

.card__tip {
  position: absolute;
  left: 0;
  bottom: calc(100% + 0.45rem);
  z-index: 4;
  width: max-content;
  max-width: min(22rem, 80vw);
  padding: 0.55rem 0.7rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  background: var(--color-surface-hover);
  color: var(--color-text);
  font-size: var(--text-xs);
  line-height: 1.4;
  box-shadow: 0 8px 24px rgb(0 0 0 / 35%);
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition: opacity 120ms ease;
}

.card:hover .card__tip,
.card:focus-visible .card__tip {
  opacity: 1;
  visibility: visible;
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
