<script setup lang="ts">
import { computed } from "vue";
import type { PerformanceSummaryDTO } from "@mplus/contracts";
import { resolveParsePercentileColor } from "../../lib/parsePercentileColor";
import { sanitizeWarcraftLogsUrl } from "../../lib/warcraftLogsUrl";

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

function parsePctClass(value: number | null | undefined): string {
  return resolveParsePercentileColor(value).className;
}

type ExplanatoryRun = NonNullable<
  NonNullable<PerformanceSummaryDTO["currentSeason"]>["dungeons"][number]["bestRun"]
>;

/** Preserve best → latest order; collapse identical BOTH entries to one numbered link. */
function selectedRunEntries(
  dungeon: NonNullable<PerformanceSummaryDTO["currentSeason"]>["dungeons"][number],
): Array<{ index: number; run: ExplanatoryRun }> {
  const runs: ExplanatoryRun[] = [];
  if (dungeon.bestRun) runs.push(dungeon.bestRun);
  if (
    dungeon.latestRun &&
    (!dungeon.bestRun || dungeon.latestRun.runId !== dungeon.bestRun.runId)
  ) {
    runs.push(dungeon.latestRun);
  }
  return runs.map((run, i) => ({ index: i + 1, run }));
}

function safeWclUrl(url: string | null | undefined): string | null {
  return sanitizeWarcraftLogsUrl(url);
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
              <td class="mpts-data">
                <span
                  class="parse-pct"
                  :class="parsePctClass(d.bestParsePercentile)"
                >{{ formatPct(d.bestParsePercentile) }}</span>
              </td>
              <td class="mpts-data">
                <span
                  class="parse-pct"
                  :class="parsePctClass(d.medianParsePercentile)"
                >{{ formatPct(d.medianParsePercentile) }}</span>
              </td>
              <td class="mpts-data">{{ d.loggedRunCount }}</td>
              <td>
                <span
                  v-if="selectedRunEntries(d).length === 0"
                  class="selected-runs selected-runs--empty"
                >—</span>
                <span v-else class="selected-runs" data-testid="selected-run-links">
                  <template v-for="(entry, i) in selectedRunEntries(d)" :key="entry.run.runId + entry.index">
                    <span v-if="i > 0" class="selected-runs__sep" aria-hidden="true">, </span>
                    <a
                      v-if="safeWclUrl(entry.run.wclUrl)"
                      class="selected-runs__link"
                      :href="safeWclUrl(entry.run.wclUrl)!"
                      target="_blank"
                      rel="noopener noreferrer"
                      :aria-label="`Open selected Warcraft Logs run ${entry.index}`"
                    >{{ entry.index }}</a>
                    <span
                      v-else
                      class="selected-runs__plain"
                      :aria-label="`Selected run ${entry.index} (no Warcraft Logs URL)`"
                    >{{ entry.index }}</span>
                  </template>
                </span>
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

.parse-pct {
  font-variant-numeric: tabular-nums;
}

.parse-pct--neutral {
  color: var(--color-text-muted);
}

.parse-pct--grey {
  color: var(--color-parse-grey);
}

.parse-pct--green {
  color: var(--color-parse-green);
}

.parse-pct--blue {
  color: var(--color-parse-blue);
}

.parse-pct--purple {
  color: var(--color-parse-purple);
}

.parse-pct--orange {
  color: var(--color-parse-orange);
}

.parse-pct--pink {
  color: var(--color-parse-pink);
}

.parse-pct--gold {
  color: var(--color-parse-gold);
}

.selected-runs {
  display: inline;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}

.selected-runs__link {
  color: var(--color-gold-300);
  text-decoration: none;
}

.selected-runs__link:hover,
.selected-runs__link:focus-visible {
  color: var(--color-brand-hover);
  text-decoration: underline;
  outline: none;
}

.selected-runs__plain {
  color: var(--color-text-muted);
}

.selected-runs--empty {
  color: var(--color-text-muted);
}
</style>
