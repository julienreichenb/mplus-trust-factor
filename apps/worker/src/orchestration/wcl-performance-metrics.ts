import type { MetricObservationDTO } from "@mplus/contracts";
import {
  computePerformanceDimension,
  resolvePerformanceMetricWeights,
  type PerformanceDungeonAggregate,
  type PerformanceSummaryDTO,
} from "@mplus/scoring";
import type { HistoricalSeasonAggregateInput, PerformanceRunRefInput } from "@mplus/scoring";

export interface BuildWclPerformanceInput {
  currentSeasonDungeons: PerformanceDungeonAggregate[];
  historicalSeasons?: HistoricalSeasonAggregateInput[];
  expectedDungeonCount: number;
  activeSpecSlug?: string | null;
  activeRoleSlug?: string | null;
  hasResolvedSpecAndRole: boolean;
  selectedRunWclCoverage: number;
  explanatoryRuns?: PerformanceRunRefInput[];
  logFreshness?: number;
  observedAt: string;
}

export interface BuildWclPerformanceResult {
  observations: MetricObservationDTO[];
  summary: PerformanceSummaryDTO;
  confidence: number;
  performanceScore: number | null;
  /** Patch onto active model metricWeights.PERFORMANCE before calculateScore. */
  performanceMetricWeights: Array<{ metricKey: string; weight: number }>;
}

/**
 * Build PERFORMANCE observations from current-season WCL dungeon percentiles.
 * Does not emit Mythic+ rating — that stays an EXPERIENCE/progression signal.
 */
export function buildWclPerformanceObservations(
  input: BuildWclPerformanceInput,
): BuildWclPerformanceResult {
  const computed = computePerformanceDimension({
    currentSeasonDungeons: input.currentSeasonDungeons,
    historicalSeasons: input.historicalSeasons,
    expectedDungeonCount: input.expectedDungeonCount,
    activeSpecSlug: input.activeSpecSlug,
    activeRoleSlug: input.activeRoleSlug,
    hasResolvedSpecAndRole: input.hasResolvedSpecAndRole,
    selectedRunWclCoverage: input.selectedRunWclCoverage,
    explanatoryRuns: input.explanatoryRuns,
    logFreshness: input.logFreshness,
  });

  const hasHistorical = computed.observations.historical != null;
  const performanceMetricWeights = resolvePerformanceMetricWeights(hasHistorical);
  const observations: MetricObservationDTO[] = [];

  if (computed.observations.peak != null) {
    observations.push({
      metricKey: "performance.current_season_peak",
      dimension: "PERFORMANCE",
      rawValue: computed.observations.peak,
      normalizedValue: computed.observations.peak,
      confidence: computed.confidence,
      observedAt: input.observedAt,
      sourceProvider: "warcraftlogs",
      coverage: {
        present: computed.summary.currentSeason.dungeonCount,
        expected: computed.summary.currentSeason.expectedDungeonCount,
        ratio:
          computed.summary.currentSeason.expectedDungeonCount > 0
            ? computed.summary.currentSeason.dungeonCount /
              computed.summary.currentSeason.expectedDungeonCount
            : 0,
      },
      context: {
        derivedFrom: "wcl_zone_rankings_best_parse",
        equalDungeonWeighting: true,
        sampleSize: computed.summary.currentSeason.dungeons.reduce(
          (s, d) => s + d.loggedRunCount,
          0,
        ),
      },
    });
  }

  if (computed.observations.consistency != null) {
    observations.push({
      metricKey: "performance.current_season_consistency",
      dimension: "PERFORMANCE",
      rawValue: computed.observations.consistency,
      normalizedValue: computed.observations.consistency,
      confidence: computed.confidence,
      observedAt: input.observedAt,
      sourceProvider: "warcraftlogs",
      coverage: {
        present: computed.summary.currentSeason.dungeonCount,
        expected: computed.summary.currentSeason.expectedDungeonCount,
        ratio:
          computed.summary.currentSeason.expectedDungeonCount > 0
            ? computed.summary.currentSeason.dungeonCount /
              computed.summary.currentSeason.expectedDungeonCount
            : 0,
      },
      context: {
        derivedFrom: "wcl_zone_rankings_median_parse",
        equalDungeonWeighting: true,
        sampleSize: computed.summary.currentSeason.dungeons.reduce(
          (s, d) => s + d.loggedRunCount,
          0,
        ),
      },
    });
  }

  if (computed.observations.historical != null && computed.summary.historical) {
    observations.push({
      metricKey: "performance.historical_best_average",
      dimension: "PERFORMANCE",
      rawValue: computed.observations.historical,
      normalizedValue: computed.observations.historical,
      confidence: Math.min(1, computed.confidence + 0.05),
      observedAt: input.observedAt,
      sourceProvider: "warcraftlogs",
      coverage: null,
      context: {
        derivedFrom: "wcl_historical_best_parse_mean",
        seasonsUsed: computed.summary.historical.seasonsUsed,
        seasons: computed.summary.historical.seasons,
        aggregateOnly: true,
      },
    });
  }

  return {
    observations,
    summary: computed.summary,
    confidence: computed.confidence,
    performanceScore: computed.performanceScore,
    performanceMetricWeights,
  };
}
