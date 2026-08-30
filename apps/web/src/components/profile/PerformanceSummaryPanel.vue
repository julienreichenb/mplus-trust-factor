<script setup lang="ts">
import { computed } from "vue";
import type { CanonicalDungeonEvidencePublicDTO, PerformanceSummaryDTO, SurvivalSummaryPublicDTO } from "@mplus/contracts";
import { resolveParsePercentileColor } from "../../lib/parsePercentileColor";
import { sanitizeDungeonImageUrl } from "../../lib/dungeonArt";
import CanonicalSelectedRunLinks from "./CanonicalSelectedRunLinks.vue";

const props = defineProps<{
  summary: PerformanceSummaryDTO | null | undefined;
  canonicalDungeonEvidence?: CanonicalDungeonEvidencePublicDTO[];
  survivalSummary?: SurvivalSummaryPublicDTO | null;
  locked?: boolean;
  /** When true, omit the section heading (parent owns the title). */
  embedded?: boolean;
}>();

const current = computed(() => props.summary?.currentSeason ?? null);
const historical = computed(() => props.summary?.historical ?? null);
const roleAware = computed(() => props.summary?.roleAware ?? null);

const LEGACY_STAT_TOOLTIPS = {
  peak:
    "Equal-weighted average of Warcraft Logs Best % (peak parse) across current-season dungeons. Measures ceiling execution.",
  consistency:
    "Equal-weighted average of Warcraft Logs Median % across current-season dungeons. Measures typical execution, not the best pull.",
  score:
    "Current-season performance blend: 65% Peak + 35% Consistency. Missing dungeons are omitted from the average — never scored as zero.",
  coverage:
    "How many of the expected season dungeons have usable WCL percentile data. Lower coverage reduces confidence, not the score itself.",
} as const;

const hasRenderableData = computed(() => {
  if (roleAware.value) {
    if (roleAware.value.role === "HEALER") {
      return healerRows.value.length > 0;
    }
    return roleAware.value.damage.dungeons.length > 0;
  }
  return Boolean(current.value && current.value.dungeonCount > 0);
});

function formatPct(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${value.toFixed(1)}%`;
}

function formatScore(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toFixed(1);
}

function parsePctClass(value: number | null | undefined): string {
  return resolveParsePercentileColor(value).className;
}

function dungeonArtUrl(slug: string): string | null {
  const dungeon = current.value?.dungeons.find((row) => row.dungeonSlug === slug);
  return sanitizeDungeonImageUrl(dungeon?.dungeonImageUrl);
}

type LegacyDungeon = NonNullable<PerformanceSummaryDTO["currentSeason"]>["dungeons"][number];

interface HealerDungeonRow {
  dungeonSlug: string;
  dungeonName: string;
  healingBest: number | null;
  healingMedian: number | null;
  damageBest: number | null;
  damageMedian: number | null;
  healingLoggedRuns: number | null;
  damageLoggedRuns: number | null;
  legacyDungeon: LegacyDungeon | null;
}

const legacyDungeonBySlug = computed(() => {
  const map = new Map<string, LegacyDungeon>();
  for (const dungeon of current.value?.dungeons ?? []) {
    map.set(dungeon.dungeonSlug, dungeon);
  }
  return map;
});

const healerRows = computed((): HealerDungeonRow[] => {
  const ra = roleAware.value;
  if (!ra || ra.role !== "HEALER") return [];

  const damageBySlug = new Map(ra.damage.dungeons.map((dungeon) => [dungeon.dungeonSlug, dungeon]));
  const healingBySlug = new Map(
    (ra.healing?.dungeons ?? []).map((dungeon) => [dungeon.dungeonSlug, dungeon]),
  );
  const slugs = new Set([...damageBySlug.keys(), ...healingBySlug.keys()]);
  const preferredOrder = current.value?.dungeons.map((dungeon) => dungeon.dungeonSlug) ?? [
    ...ra.healing?.dungeons.map((dungeon) => dungeon.dungeonSlug) ?? [],
    ...ra.damage.dungeons.map((dungeon) => dungeon.dungeonSlug),
  ];
  const orderedSlugs = [
    ...preferredOrder.filter((slug) => slugs.has(slug)),
    ...[...slugs].filter((slug) => !preferredOrder.includes(slug)),
  ];

  return orderedSlugs.map((slug) => {
    const damage = damageBySlug.get(slug);
    const healing = healingBySlug.get(slug);
    return {
      dungeonSlug: slug,
      dungeonName:
        healing?.dungeonName ?? damage?.dungeonName ?? legacyDungeonBySlug.value.get(slug)?.dungeonName ?? slug,
      healingBest: healing?.bestParsePercentile ?? null,
      healingMedian: healing?.medianParsePercentile ?? null,
      damageBest: damage?.bestParsePercentile ?? null,
      damageMedian: damage?.medianParsePercentile ?? null,
      healingLoggedRuns: healing?.loggedRunCount ?? null,
      damageLoggedRuns: damage?.loggedRunCount ?? null,
      legacyDungeon: legacyDungeonBySlug.value.get(slug) ?? null,
    };
  });
});

function formatHealerLoggedRuns(
  healing: number | null | undefined,
  damage: number | null | undefined,
): string {
  const heal = healing != null && Number.isFinite(healing) ? healing : null;
  const dmg = damage != null && Number.isFinite(damage) ? damage : null;
  if (heal == null && dmg == null) return "—";
  if (heal != null && dmg != null) {
    return heal === dmg ? String(heal) : `${heal} · ${dmg}`;
  }
  return String(heal ?? dmg);
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
    <template v-else-if="!hasRenderableData">
      <p class="empty" data-testid="performance-summary-empty">
        No current-season WCL percentile data is available for this character.
      </p>
    </template>

    <template v-else-if="roleAware">
      <dl
        v-if="roleAware.role === 'HEALER' || roleAware.role === 'TANK'"
        class="cards"
        data-testid="performance-summary-role-aware-cards"
      >
        <template v-if="roleAware.role === 'HEALER'">
          <div class="card">
            <dt>Healing</dt>
            <dd class="mpts-data">{{ formatScore(roleAware.healing?.score) }}</dd>
            <span class="card__hint">Healing parse mix this season</span>
          </div>
          <div class="card">
            <dt>Damage</dt>
            <dd class="mpts-data">{{ formatScore(roleAware.damage.score) }}</dd>
            <span class="card__hint">Damage parse mix this season</span>
          </div>
        </template>
        <template v-else-if="roleAware.role === 'TANK'">
          <div class="card">
            <dt>Damage</dt>
            <dd class="mpts-data">{{ formatScore(roleAware.damage.score) }}</dd>
            <span class="card__hint">Damage parse mix this season</span>
          </div>
          <div class="card">
            <dt>Survival</dt>
            <dd class="mpts-data">{{ formatScore(survivalSummary?.score) }}</dd>
            <span class="card__hint">How well this tank lives through keys</span>
          </div>
        </template>
      </dl>

      <div v-if="roleAware.role === 'HEALER'" class="table-wrap">
        <table data-testid="performance-summary-healer-table">
          <caption class="sr-only">Per-dungeon healing and damage parse percentiles</caption>
          <thead>
            <tr>
              <th scope="col" rowspan="2" class="dungeon-art-col">
                <span class="sr-only">Dungeon art</span>
              </th>
              <th scope="col" rowspan="2">Dungeon</th>
              <th scope="colgroup" colspan="2">Healing</th>
              <th scope="colgroup" colspan="2">Damage</th>
              <th scope="col" rowspan="2">Logs</th>
              <th scope="col" rowspan="2">Selected runs</th>
            </tr>
            <tr>
              <th scope="col">Best %</th>
              <th scope="col">Median %</th>
              <th scope="col">Best %</th>
              <th scope="col">Median %</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in healerRows" :key="row.dungeonSlug">
              <td class="dungeon-art-col">
                <img
                  v-if="dungeonArtUrl(row.dungeonSlug)"
                  class="dungeon-art"
                  :src="dungeonArtUrl(row.dungeonSlug)!"
                  alt=""
                />
              </td>
              <th scope="row">{{ row.dungeonName }}</th>
              <td class="mpts-data">
                <span class="parse-pct" :class="parsePctClass(row.healingBest)">{{
                  formatPct(row.healingBest)
                }}</span>
              </td>
              <td class="mpts-data">
                <span class="parse-pct" :class="parsePctClass(row.healingMedian)">{{
                  formatPct(row.healingMedian)
                }}</span>
              </td>
              <td class="mpts-data">
                <span class="parse-pct" :class="parsePctClass(row.damageBest)">{{
                  formatPct(row.damageBest)
                }}</span>
              </td>
              <td class="mpts-data">
                <span class="parse-pct" :class="parsePctClass(row.damageMedian)">{{
                  formatPct(row.damageMedian)
                }}</span>
              </td>
              <td class="mpts-data">{{
                formatHealerLoggedRuns(row.healingLoggedRuns, row.damageLoggedRuns)
              }}</td>
              <td>
                <CanonicalSelectedRunLinks
                  :dungeon-slug="row.dungeonSlug"
                  :canonical-dungeon-evidence="canonicalDungeonEvidence"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-else class="table-wrap">
        <table data-testid="performance-summary-damage-table">
          <caption class="sr-only">Per-dungeon Best and Median parse percentiles</caption>
          <thead>
            <tr>
              <th scope="col" class="dungeon-art-col">
                <span class="sr-only">Dungeon art</span>
              </th>
              <th scope="col">Dungeon</th>
              <th scope="col">Best %</th>
              <th scope="col">Median %</th>
              <th scope="col">Logs</th>
              <th scope="col">Selected runs</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="dungeon in roleAware.damage.dungeons"
              :key="dungeon.dungeonSlug"
            >
              <td class="dungeon-art-col">
                <img
                  v-if="dungeonArtUrl(dungeon.dungeonSlug)"
                  class="dungeon-art"
                  :src="dungeonArtUrl(dungeon.dungeonSlug)!"
                  alt=""
                />
              </td>
              <th scope="row">{{ dungeon.dungeonName }}</th>
              <td class="mpts-data">
                <span
                  class="parse-pct"
                  :class="parsePctClass(dungeon.bestParsePercentile)"
                >{{ formatPct(dungeon.bestParsePercentile) }}</span>
              </td>
              <td class="mpts-data">
                <span
                  class="parse-pct"
                  :class="parsePctClass(dungeon.medianParsePercentile)"
                >{{ formatPct(dungeon.medianParsePercentile) }}</span>
              </td>
              <td class="mpts-data">{{ dungeon.loggedRunCount }}</td>
              <td>
                <CanonicalSelectedRunLinks
                  :dungeon-slug="dungeon.dungeonSlug"
                  :canonical-dungeon-evidence="canonicalDungeonEvidence"
                />
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

    <template v-else>
      <dl class="cards">
        <div class="card" tabindex="0">
          <dt>Peak</dt>
          <dd class="mpts-data">{{ formatPct(current!.peakScore) }}</dd>
          <span class="card__tip" role="tooltip">{{ LEGACY_STAT_TOOLTIPS.peak }}</span>
        </div>
        <div class="card" tabindex="0">
          <dt>Consistency</dt>
          <dd class="mpts-data">{{ formatPct(current!.consistencyScore) }}</dd>
          <span class="card__tip" role="tooltip">{{ LEGACY_STAT_TOOLTIPS.consistency }}</span>
        </div>
        <div class="card" tabindex="0">
          <dt>Score</dt>
          <dd class="mpts-data">{{ formatPct(current!.score) }}</dd>
          <span class="card__tip" role="tooltip">{{ LEGACY_STAT_TOOLTIPS.score }}</span>
        </div>
        <div class="card" tabindex="0">
          <dt>Coverage</dt>
          <dd class="mpts-data">
            {{ current!.dungeonCount }}/{{ current!.expectedDungeonCount }} dungeons
          </dd>
          <span class="card__tip" role="tooltip">{{ LEGACY_STAT_TOOLTIPS.coverage }}</span>
        </div>
      </dl>

      <div class="table-wrap">
        <table>
          <caption class="sr-only">Per-dungeon Best and Median parse percentiles</caption>
          <thead>
            <tr>
              <th scope="col" class="dungeon-art-col">
                <span class="sr-only">Dungeon art</span>
              </th>
              <th scope="col">Dungeon</th>
              <th scope="col">Best %</th>
              <th scope="col">Median %</th>
              <th scope="col">Logs</th>
              <th scope="col">Selected runs</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="d in current!.dungeons" :key="d.dungeonSlug">
              <td class="dungeon-art-col">
                <img
                  v-if="dungeonArtUrl(d.dungeonSlug)"
                  class="dungeon-art"
                  :src="dungeonArtUrl(d.dungeonSlug)!"
                  alt=""
                />
              </td>
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
                <CanonicalSelectedRunLinks
                  :dungeon-slug="d.dungeonSlug"
                  :canonical-dungeon-evidence="canonicalDungeonEvidence"
                />
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

.card__hint {
  display: block;
  margin-top: 0.25rem;
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  text-transform: none;
  letter-spacing: 0;
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
  vertical-align: middle;
}

.dungeon-art-col {
  width: 3.25rem;
  padding-right: var(--space-2);
}

.dungeon-art {
  display: block;
  width: 2.75rem;
  height: 1.85rem;
  object-fit: cover;
  border-radius: var(--radius-control);
  border: 1px solid var(--color-border);
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
</style>
