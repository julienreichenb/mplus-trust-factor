import type { MetricObservationDTO, RaiderIoSeasonCutoffs } from "@mplus/contracts";
import {
  computePerformanceDimension,
  computePerformanceDimensionV3,
  resolvePerformanceV3MetricWeights,
  PERFORMANCE_V3_FORMULA_VERSION,
  type PerformanceDungeonAggregate,
  type PerformanceSummaryDTO,
  type PerformanceV3DungeonInput,
  type SeasonKeyDifficultyContext,
  type HistoricalSeasonAggregateInput,
  type PerformanceRunRefInput,
} from "@mplus/scoring";

export interface BuildWclPerformanceInput {
  /** @deprecated v2 aggregate path — retained for before/after comparisons only. */
  currentSeasonDungeons?: PerformanceDungeonAggregate[];
  historicalSeasons?: HistoricalSeasonAggregateInput[];
  expectedDungeonCount: number;
  activeSpecSlug?: string | null;
  activeRoleSlug?: string | null;
  hasResolvedSpecAndRole: boolean;
  selectedRunWclCoverage: number;
  explanatoryRuns?: PerformanceRunRefInput[];
  logFreshness?: number;
  observedAt: string;
  /** Performance v3 selected-run inputs (preferred driver). */
  selectedRuns?: PerformanceV3DungeonInput[];
  seasonSlug?: string | null;
  region?: string | null;
  cutoffs?: RaiderIoSeasonCutoffs | null;
  regionalKeyAnchors?: SeasonKeyDifficultyContext["regionalAnchors"];
}

export interface BuildWclPerformanceResult {
  observations: MetricObservationDTO[];
  summary: PerformanceSummaryDTO;
  confidence: number;
  performanceScore: number | null;
  /** Patch onto active model metricWeights.PERFORMANCE before calculateScore. */
  performanceMetricWeights: Array<{ metricKey: string; weight: number }>;
  formulaVersion: string;
}

function dungeonTitle(slug: string, name?: string | null): string {
  if (name && name.trim()) return name.trim();
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Build PERFORMANCE observations from selected-run WCL parses + key difficulty (v3).
 * Does not emit Mythic+ rating — that stays an EXPERIENCE/progression signal.
 * Does not drive scores from character-wide best/median aggregates.
 */
export function buildWclPerformanceObservations(
  input: BuildWclPerformanceInput,
): BuildWclPerformanceResult {
  const selectedRuns = input.selectedRuns ?? [];

  if (selectedRuns.length > 0) {
    const computed = computePerformanceDimensionV3({
      dungeons: selectedRuns.map((d) => ({
        ...d,
        dungeonName: d.dungeonName || dungeonTitle(d.dungeonSlug),
      })),
      expectedDungeonCount: input.expectedDungeonCount,
      keyDifficultyContext: {
        seasonSlug: input.seasonSlug ?? input.cutoffs?.seasonSlug ?? null,
        region: input.region ?? input.cutoffs?.region ?? null,
        regionalAnchors: input.regionalKeyAnchors ?? null,
        top25CutoffScore: input.cutoffs?.top25Percent?.score ?? null,
        observedKeyLevels: selectedRuns.map((r) => r.keyLevel),
      },
      hasResolvedSpecAndRole: input.hasResolvedSpecAndRole,
      selectedRunWclCoverage: input.selectedRunWclCoverage,
      logFreshness: input.logFreshness,
    });

    const latestObservedAt =
      selectedRuns
        .map((d) => d.completedAt)
        .filter((v): v is string => typeof v === "string")
        .sort()
        .at(-1) ?? null;

    const dungeonSummaries = computed.dungeons.map((d) => {
      const timed = d.timed === true;
      const explanatory =
        d.executionPercentile != null || d.keyDifficultyPercentile != null
          ? {
              runId: d.canonicalRunId,
              kind: "BOTH" as const,
              dungeonSlug: d.dungeonSlug,
              dungeonName: d.dungeonName,
              keyLevel: d.keyLevel,
              completedAt: d.completedAt,
              timed,
              parsePercentile: d.executionPercentile,
              scoreValue: null as number | null,
            }
          : null;
      return {
        dungeonSlug: d.dungeonSlug,
        dungeonName: d.dungeonName,
        bestParsePercentile: d.executionPercentile,
        medianParsePercentile: null,
        loggedRunCount: d.executionPercentile != null ? 1 : 0,
        bestRun: explanatory,
        latestRun: null,
        executionPercentile: d.executionPercentile,
        keyDifficultyPercentile: d.keyDifficultyPercentile,
        runPerformance: d.runPerformance,
        dungeonConfidence: d.confidence,
        source: d.source,
        selectedKeyLevel: d.keyLevel,
        canonicalRunId: d.canonicalRunId,
      };
    });

    const summary: PerformanceSummaryDTO = {
      currentSeason: {
        // Explanation continuity: peak ≈ mean execution, consistency ≈ mean key difficulty.
        peakScore: computed.meanExecutionPercentile,
        consistencyScore: computed.meanKeyDifficultyPercentile,
        score: computed.performanceScore,
        confidence: computed.confidence,
        dungeonCount: computed.dungeonCount,
        expectedDungeonCount: computed.expectedDungeonCount,
        latestObservedAt,
        dungeons: dungeonSummaries,
        formulaVersion: computed.formulaVersion,
      },
      // Historical seasons do not enter current Performance v3.
      historical: null,
    };

    const observations: MetricObservationDTO[] = [];
    const coverage = {
      present: computed.dungeonCount,
      expected: computed.expectedDungeonCount,
      ratio:
        computed.expectedDungeonCount > 0
          ? computed.dungeonCount / computed.expectedDungeonCount
          : 0,
    };

    if (computed.observations.runPerformance != null) {
      observations.push({
        metricKey: "performance.v3.run_performance",
        dimension: "PERFORMANCE",
        rawValue: computed.observations.runPerformance,
        normalizedValue: computed.observations.runPerformance,
        confidence: computed.confidence,
        observedAt: input.observedAt,
        sourceProvider: "warcraftlogs",
        coverage,
        context: {
          formulaVersion: computed.formulaVersion,
          derivedFrom: "selected_run_execution_and_key_difficulty",
          equalDungeonWeighting: true,
          executionWeight: 0.65,
          keyDifficultyWeight: 0.35,
          meanExecutionPercentile: computed.meanExecutionPercentile,
          meanKeyDifficultyPercentile: computed.meanKeyDifficultyPercentile,
          dungeons: computed.dungeons.map((d) => ({
            dungeonSlug: d.dungeonSlug,
            canonicalRunId: d.canonicalRunId,
            keyLevel: d.keyLevel,
            executionPercentile: d.executionPercentile,
            keyDifficultyPercentile: d.keyDifficultyPercentile,
            runPerformance: d.runPerformance,
            confidence: d.confidence,
            source: d.source,
            unavailableReason: d.unavailableReason,
          })),
        },
      });
    }

    return {
      observations,
      summary,
      confidence: computed.confidence,
      performanceScore: computed.performanceScore,
      performanceMetricWeights: resolvePerformanceV3MetricWeights(),
      formulaVersion: computed.formulaVersion,
    };
  }

  // Legacy v2 path when selected runs are not supplied (tests / migration).
  const computed = computePerformanceDimension({
    currentSeasonDungeons: input.currentSeasonDungeons ?? [],
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
        legacyV2: true,
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
        legacyV2: true,
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
        legacyV2: true,
      },
    });
  }

  return {
    observations,
    summary: computed.summary,
    confidence: computed.confidence,
    performanceScore: computed.performanceScore,
    performanceMetricWeights: hasHistorical
      ? [
          { metricKey: "performance.current_season_peak", weight: 0.85 * 0.65 },
          { metricKey: "performance.current_season_consistency", weight: 0.85 * 0.35 },
          { metricKey: "performance.historical_best_average", weight: 0.15 },
        ]
      : [
          { metricKey: "performance.current_season_peak", weight: 0.65 },
          { metricKey: "performance.current_season_consistency", weight: 0.35 },
        ],
    formulaVersion: hasHistorical ? "performance-v2-with-historical" : "performance-v2",
  };
}

export { PERFORMANCE_V3_FORMULA_VERSION };
