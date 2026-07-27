import { clamp01 } from "../math.js";
import type {
  ComputePerformanceInput,
  ComputePerformanceResult,
  HistoricalSeasonAggregateInput,
  PerformanceDungeonAggregate,
  PerformanceDungeonSummary,
  PerformanceExplanatoryRun,
  PerformanceHistoricalSummary,
  PerformanceRunRefInput,
  PerformanceSummaryDTO,
} from "./types.js";

/** Current-season mix: peak vs consistency. */
export const CURRENT_SEASON_PEAK_WEIGHT = 0.65;
export const CURRENT_SEASON_CONSISTENCY_WEIGHT = 0.35;

/** Overall mix when historical data exists. */
export const OVERALL_CURRENT_WEIGHT = 0.85;
export const OVERALL_HISTORICAL_WEIGHT = 0.15;

/** Recency weights for previous / -2 / -3 seasons (renormalized when fewer). */
export const HISTORICAL_RECENCY_WEIGHTS: Record<1 | 2 | 3, number> = {
  1: 0.6,
  2: 0.3,
  3: 0.1,
};

export function meanOfValid(values: Array<number | null | undefined>): number | null {
  const valid = values.filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v),
  );
  if (valid.length === 0) return null;
  return valid.reduce((sum, v) => sum + v, 0) / valid.length;
}

/**
 * Equal-weight arithmetic mean of each dungeon's best parse percentile.
 * Missing dungeons are omitted (never zero-filled).
 */
export function computeCurrentSeasonPeak(
  dungeons: PerformanceDungeonAggregate[],
): number | null {
  return meanOfValid(dungeons.map((d) => d.bestParsePercentile));
}

/**
 * Equal-weight arithmetic mean of each dungeon's median parse percentile.
 * Missing dungeons are omitted (never zero-filled).
 */
export function computeCurrentSeasonConsistency(
  dungeons: PerformanceDungeonAggregate[],
): number | null {
  return meanOfValid(dungeons.map((d) => d.medianParsePercentile));
}

export function combineCurrentSeasonScore(
  peak: number | null,
  consistency: number | null,
): number | null {
  if (peak == null && consistency == null) return null;
  if (peak != null && consistency != null) {
    return CURRENT_SEASON_PEAK_WEIGHT * peak + CURRENT_SEASON_CONSISTENCY_WEIGHT * consistency;
  }
  // One signal only — use it at full weight (do not invent a zero partner).
  return peak ?? consistency;
}

/**
 * Mean of best parse percentiles for a historical season (equal dungeon weight).
 */
export function computeHistoricalSeasonScore(
  dungeons: PerformanceDungeonAggregate[],
): number | null {
  return meanOfValid(dungeons.map((d) => d.bestParsePercentile));
}

function matchesActiveIdentity(
  season: HistoricalSeasonAggregateInput,
  activeSpecSlug: string | null | undefined,
  activeRoleSlug: string | null | undefined,
): boolean {
  if (activeSpecSlug != null && season.specSlug != null && season.specSlug !== activeSpecSlug) {
    return false;
  }
  if (activeRoleSlug != null && season.roleSlug != null && season.roleSlug !== activeRoleSlug) {
    return false;
  }
  return true;
}

/**
 * Weight up to three previous seasons by recency (60/30/10), renormalizing when fewer.
 */
export function computeHistoricalPerformance(
  seasons: HistoricalSeasonAggregateInput[],
  activeSpecSlug?: string | null,
  activeRoleSlug?: string | null,
): PerformanceHistoricalSummary | null {
  const eligible = seasons
    .filter((s) => matchesActiveIdentity(s, activeSpecSlug, activeRoleSlug))
    .map((s) => {
      const averageBestParsePercentile = computeHistoricalSeasonScore(s.dungeons);
      const dungeonCount = s.dungeons.filter(
        (d) => d.bestParsePercentile != null && Number.isFinite(d.bestParsePercentile),
      ).length;
      return averageBestParsePercentile == null || dungeonCount === 0
        ? null
        : {
            seasonSlug: s.seasonSlug,
            recencyRank: s.recencyRank,
            averageBestParsePercentile,
            dungeonCount,
          };
    })
    .filter((s): s is NonNullable<typeof s> => s != null)
    .sort((a, b) => a.recencyRank - b.recencyRank)
    .slice(0, 3);

  if (eligible.length === 0) return null;

  const weightSum = eligible.reduce(
    (sum, s) => sum + HISTORICAL_RECENCY_WEIGHTS[s.recencyRank],
    0,
  );
  const score = eligible.reduce(
    (sum, s) =>
      sum +
      s.averageBestParsePercentile *
        (HISTORICAL_RECENCY_WEIGHTS[s.recencyRank] / weightSum),
    0,
  );

  return {
    score,
    seasonsUsed: eligible.length,
    seasons: eligible.map((s) => ({
      seasonSlug: s.seasonSlug,
      averageBestParsePercentile: s.averageBestParsePercentile,
      dungeonCount: s.dungeonCount,
    })),
  };
}

export function combineOverallPerformanceScore(
  currentSeasonScore: number | null,
  historical: PerformanceHistoricalSummary | null,
): number | null {
  if (currentSeasonScore == null) return null;
  if (historical == null) return currentSeasonScore;
  return (
    OVERALL_CURRENT_WEIGHT * currentSeasonScore +
    OVERALL_HISTORICAL_WEIGHT * historical.score
  );
}

function runPerformanceRank(run: PerformanceRunRefInput): number {
  if (run.parsePercentile != null && Number.isFinite(run.parsePercentile)) {
    return run.parsePercentile;
  }
  if (run.scoreValue != null && Number.isFinite(run.scoreValue)) {
    return run.scoreValue;
  }
  return Number.NEGATIVE_INFINITY;
}

function toExplanatoryRun(
  run: PerformanceRunRefInput,
  kind: PerformanceExplanatoryRun["kind"],
  dungeonName: string,
): PerformanceExplanatoryRun {
  return {
    runId: run.runId,
    kind,
    dungeonSlug: run.dungeonSlug,
    dungeonName: run.dungeonName ?? dungeonName,
    keyLevel: run.keyLevel,
    completedAt: run.completedAt,
    timed: run.timed,
    parsePercentile: run.parsePercentile,
    scoreValue: run.scoreValue,
  };
}

/**
 * At most two explanatory runs per dungeon: best performance + chronologically latest.
 * Same canonical run → single BOTH entry (caller may flatten).
 */
export function selectExplanatoryRunsForDungeon(
  runs: PerformanceRunRefInput[],
  dungeonSlug: string,
  dungeonName: string,
): { bestRun: PerformanceExplanatoryRun | null; latestRun: PerformanceExplanatoryRun | null } {
  const forDungeon = runs.filter((r) => r.dungeonSlug === dungeonSlug);
  if (forDungeon.length === 0) {
    return { bestRun: null, latestRun: null };
  }

  const best = [...forDungeon].sort((a, b) => {
    const rankDiff = runPerformanceRank(b) - runPerformanceRank(a);
    if (rankDiff !== 0) return rankDiff;
    return new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime();
  })[0]!;

  const latest = [...forDungeon].sort(
    (a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime(),
  )[0]!;

  if (best.runId === latest.runId) {
    const both = toExplanatoryRun(best, "BOTH", dungeonName);
    return { bestRun: both, latestRun: both };
  }

  return {
    bestRun: toExplanatoryRun(best, "BEST", dungeonName),
    latestRun: toExplanatoryRun(latest, "LATEST", dungeonName),
  };
}

function dungeonsWithValidPercentile(
  dungeons: PerformanceDungeonAggregate[],
): PerformanceDungeonAggregate[] {
  return dungeons.filter(
    (d) =>
      (d.bestParsePercentile != null && Number.isFinite(d.bestParsePercentile)) ||
      (d.medianParsePercentile != null && Number.isFinite(d.medianParsePercentile)),
  );
}

/**
 * Independent PERFORMANCE confidence. Missing data lowers confidence only —
 * never invents zero percentile scores.
 */
export function computePerformanceConfidence(input: {
  dungeonCount: number;
  expectedDungeonCount: number;
  totalLoggedRuns: number;
  dungeonsWithBothPercentiles: number;
  dungeonsWithAnyPercentile: number;
  logFreshness: number;
  selectedRunWclCoverage: number;
  hasResolvedSpecAndRole: boolean;
  hasHistorical: boolean;
}): number {
  if (input.dungeonsWithAnyPercentile === 0) return 0;

  const expected = Math.max(1, input.expectedDungeonCount);
  const coverage = clamp01(input.dungeonCount / expected);
  // A single dungeon with one exceptional parse must not yield high confidence.
  const breadth =
    input.dungeonCount <= 1
      ? 0.25
      : input.dungeonCount <= 2
        ? 0.45
        : input.dungeonCount <= 4
          ? 0.7
          : clamp01(0.7 + 0.3 * ((input.dungeonCount - 4) / Math.max(1, expected - 4)));

  const volume =
    input.totalLoggedRuns <= 1
      ? 0.2
      : input.totalLoggedRuns <= 3
        ? 0.4
        : input.totalLoggedRuns <= 8
          ? 0.65
          : clamp01(0.65 + 0.35 * Math.min(1, (input.totalLoggedRuns - 8) / 24));

  const bothRatio =
    input.dungeonsWithAnyPercentile > 0
      ? input.dungeonsWithBothPercentiles / input.dungeonsWithAnyPercentile
      : 0;

  const freshness = clamp01(input.logFreshness);
  const wclCoverage = clamp01(input.selectedRunWclCoverage);
  const identity = input.hasResolvedSpecAndRole ? 1 : 0.7;
  // Historical may slightly improve confidence but cannot compensate for thin current season.
  const historicalBoost = input.hasHistorical ? 0.04 : 0;

  const base =
    0.28 * coverage +
    0.22 * breadth +
    0.18 * volume +
    0.12 * bothRatio +
    0.1 * freshness +
    0.1 * wclCoverage;

  return clamp01(base * identity + historicalBoost * Math.min(1, coverage));
}

/**
 * Model metric weights for PERFORMANCE. Renormalizes when historical is absent
 * so missing history does not reduce coverage or invent a penalty.
 */
export function resolvePerformanceMetricWeights(hasHistorical: boolean): Array<{
  metricKey: string;
  weight: number;
}> {
  if (hasHistorical) {
    return [
      {
        metricKey: "performance.current_season_peak",
        weight: OVERALL_CURRENT_WEIGHT * CURRENT_SEASON_PEAK_WEIGHT,
      },
      {
        metricKey: "performance.current_season_consistency",
        weight: OVERALL_CURRENT_WEIGHT * CURRENT_SEASON_CONSISTENCY_WEIGHT,
      },
      { metricKey: "performance.historical_best_average", weight: OVERALL_HISTORICAL_WEIGHT },
    ];
  }
  return [
    { metricKey: "performance.current_season_peak", weight: CURRENT_SEASON_PEAK_WEIGHT },
    {
      metricKey: "performance.current_season_consistency",
      weight: CURRENT_SEASON_CONSISTENCY_WEIGHT,
    },
  ];
}

export function computePerformanceDimension(
  input: ComputePerformanceInput,
): ComputePerformanceResult {
  const validDungeons = dungeonsWithValidPercentile(input.currentSeasonDungeons);
  const peak = computeCurrentSeasonPeak(validDungeons);
  const consistency = computeCurrentSeasonConsistency(validDungeons);
  const currentSeasonScore = combineCurrentSeasonScore(peak, consistency);

  const historical = computeHistoricalPerformance(
    input.historicalSeasons ?? [],
    input.activeSpecSlug,
    input.activeRoleSlug,
  );

  const performanceScore = combineOverallPerformanceScore(currentSeasonScore, historical);

  const dungeonsWithBoth = validDungeons.filter(
    (d) =>
      d.bestParsePercentile != null &&
      Number.isFinite(d.bestParsePercentile) &&
      d.medianParsePercentile != null &&
      Number.isFinite(d.medianParsePercentile),
  ).length;

  const totalLoggedRuns = validDungeons.reduce(
    (sum, d) => sum + Math.max(0, d.loggedRunCount),
    0,
  );

  const latestObservedAt =
    validDungeons
      .map((d) => d.latestObservedAt)
      .filter((v): v is string => typeof v === "string")
      .sort()
      .at(-1) ?? null;

  const confidence = computePerformanceConfidence({
    dungeonCount: validDungeons.length,
    expectedDungeonCount: input.expectedDungeonCount,
    totalLoggedRuns,
    dungeonsWithBothPercentiles: dungeonsWithBoth,
    dungeonsWithAnyPercentile: validDungeons.length,
    logFreshness: input.logFreshness ?? (validDungeons.length > 0 ? 0.75 : 0),
    selectedRunWclCoverage: input.selectedRunWclCoverage,
    hasResolvedSpecAndRole: input.hasResolvedSpecAndRole,
    hasHistorical: historical != null,
  });

  const explanatoryRuns = input.explanatoryRuns ?? [];
  const dungeonSummaries: PerformanceDungeonSummary[] = validDungeons.map((d) => {
    const selected = selectExplanatoryRunsForDungeon(
      explanatoryRuns,
      d.dungeonSlug,
      d.dungeonName,
    );
    // Collapse BOTH into a single reference on bestRun; clear duplicate latest.
    const bothSame =
      selected.bestRun != null &&
      selected.latestRun != null &&
      selected.bestRun.runId === selected.latestRun.runId;
    return {
      dungeonSlug: d.dungeonSlug,
      dungeonName: d.dungeonName,
      bestParsePercentile: d.bestParsePercentile,
      medianParsePercentile: d.medianParsePercentile,
      loggedRunCount: d.loggedRunCount,
      bestRun: selected.bestRun,
      latestRun: bothSame ? null : selected.latestRun,
    };
  });

  const summary: PerformanceSummaryDTO = {
    currentSeason: {
      peakScore: peak,
      consistencyScore: consistency,
      score: currentSeasonScore,
      confidence,
      dungeonCount: validDungeons.length,
      expectedDungeonCount: input.expectedDungeonCount,
      latestObservedAt,
      dungeons: dungeonSummaries,
    },
    historical,
  };

  return {
    summary,
    currentSeasonScore,
    performanceScore,
    confidence,
    observations: {
      peak,
      consistency,
      historical: historical?.score ?? null,
    },
  };
}
