import { clamp01 } from "../math.js";
import { meanOfValid } from "./aggregate.js";
import {
  computeKeyDifficultyPercentile,
  type KeyDifficultyNormalizationSource,
  type SeasonKeyDifficultyContext,
} from "./key-difficulty.js";
/** Performance v3 mix: execution vs key difficulty (per selected run). */
export const PERFORMANCE_V3_EXECUTION_WEIGHT = 0.65;
export const PERFORMANCE_V3_KEY_DIFFICULTY_WEIGHT = 0.35;

/** Formula version persisted on v3 observations / provenance. */
export const PERFORMANCE_V3_FORMULA_VERSION = "performance-v3-selected-runs-v1";

export interface PerformanceV3DungeonInput {
  dungeonSlug: string;
  dungeonName: string;
  canonicalRunId: string;
  keyLevel: number;
  timed: boolean | null;
  completedAt: string;
  /** WCL execution percentile tied to this selected fight only. */
  executionPercentile: number | null;
  raiderIoScore?: number | null;
  wclReportMatched: boolean;
  wclCoverageRatio: number | null;
  parseSource?: string | null;
  bracketMatched?: boolean;
}

export interface PerformanceV3DungeonResult {
  dungeonSlug: string;
  dungeonName: string;
  canonicalRunId: string;
  keyLevel: number;
  timed: boolean | null;
  completedAt: string;
  executionPercentile: number | null;
  keyDifficultyPercentile: number | null;
  runPerformance: number | null;
  confidence: number;
  source: string;
  keyDifficultySource: KeyDifficultyNormalizationSource | null;
  unavailableReason: string | null;
}

export interface ComputePerformanceV3Input {
  dungeons: PerformanceV3DungeonInput[];
  expectedDungeonCount: number;
  keyDifficultyContext: SeasonKeyDifficultyContext;
  hasResolvedSpecAndRole: boolean;
  /** Fraction of selected runs with usable WCL combat/parse coverage (0–1). */
  selectedRunWclCoverage: number;
  logFreshness?: number;
}

export interface ComputePerformanceV3Result {
  /** Equal-weight mean of available runPerformance values. */
  performanceScore: number | null;
  meanExecutionPercentile: number | null;
  meanKeyDifficultyPercentile: number | null;
  confidence: number;
  dungeonCount: number;
  expectedDungeonCount: number;
  dungeons: PerformanceV3DungeonResult[];
  formulaVersion: string;
  observations: {
    runPerformance: number | null;
    execution: number | null;
    keyDifficulty: number | null;
  };
}

/**
 * Per-dungeon: 65% selected-run execution + 35% season-relative key difficulty.
 * Missing inputs omit the dungeon from the mean (never zero-filled).
 */
export function computeRunPerformance(input: {
  executionPercentile: number | null;
  keyDifficultyPercentile: number | null;
}): number | null {
  const exec = input.executionPercentile;
  const key = input.keyDifficultyPercentile;
  if (
    exec == null ||
    !Number.isFinite(exec) ||
    key == null ||
    !Number.isFinite(key)
  ) {
    return null;
  }
  return (
    PERFORMANCE_V3_EXECUTION_WEIGHT * exec +
    PERFORMANCE_V3_KEY_DIFFICULTY_WEIGHT * key
  );
}

/**
 * Independent PERFORMANCE v3 confidence. Coverage/freshness affect confidence only.
 */
export function computePerformanceV3Confidence(input: {
  dungeonCountWithScore: number;
  expectedDungeonCount: number;
  dungeonsWithExecution: number;
  dungeonsWithKeyDifficulty: number;
  keyDifficultyConfidenceMean: number;
  selectedRunWclCoverage: number;
  logFreshness: number;
  hasResolvedSpecAndRole: boolean;
}): number {
  if (input.dungeonCountWithScore === 0 && input.dungeonsWithExecution === 0) {
    return 0;
  }

  const expected = Math.max(1, input.expectedDungeonCount);
  const coverage = clamp01(input.dungeonCountWithScore / expected);
  const breadth =
    input.dungeonCountWithScore <= 1
      ? 0.25
      : input.dungeonCountWithScore <= 2
        ? 0.45
        : input.dungeonCountWithScore <= 4
          ? 0.7
          : clamp01(
              0.7 +
                0.3 *
                  ((input.dungeonCountWithScore - 4) /
                    Math.max(1, expected - 4)),
            );

  const execCoverage =
    expected > 0 ? clamp01(input.dungeonsWithExecution / expected) : 0;
  const keyCoverage =
    expected > 0 ? clamp01(input.dungeonsWithKeyDifficulty / expected) : 0;
  const keyQuality = clamp01(input.keyDifficultyConfidenceMean);
  const freshness = clamp01(input.logFreshness);
  const wclCoverage = clamp01(input.selectedRunWclCoverage);
  const identity = input.hasResolvedSpecAndRole ? 1 : 0.7;

  const base =
    0.26 * coverage +
    0.18 * breadth +
    0.16 * execCoverage +
    0.12 * keyCoverage +
    0.1 * keyQuality +
    0.1 * freshness +
    0.08 * wclCoverage;

  return clamp01(base * identity);
}

export function resolvePerformanceV3MetricWeights(): Array<{
  metricKey: string;
  weight: number;
}> {
  return [{ metricKey: "performance.v3.run_performance", weight: 1 }];
}

/**
 * Performance v3 over the eight selected highest-key current-season runs only.
 * Does not blend historical seasons or character-wide best/median aggregates.
 */
export function computePerformanceDimensionV3(
  input: ComputePerformanceV3Input,
): ComputePerformanceV3Result {
  const observedKeys = input.dungeons.map((d) => d.keyLevel);
  const keyContext: SeasonKeyDifficultyContext = {
    ...input.keyDifficultyContext,
    observedKeyLevels:
      input.keyDifficultyContext.observedKeyLevels ?? observedKeys,
  };

  const dungeons: PerformanceV3DungeonResult[] = input.dungeons.map((d) => {
    const keyDiff = computeKeyDifficultyPercentile({
      keyLevel: d.keyLevel,
      timed: d.timed,
      context: keyContext,
    });

    const execution =
      d.executionPercentile != null && Number.isFinite(d.executionPercentile)
        ? d.executionPercentile
        : null;

    const runPerformance = computeRunPerformance({
      executionPercentile: execution,
      keyDifficultyPercentile: keyDiff.percentile,
    });

    let unavailableReason: string | null = null;
    if (execution == null && keyDiff.percentile == null) {
      unavailableReason = "execution_and_key_difficulty_unavailable";
    } else if (execution == null) {
      unavailableReason =
        d.parseSource === "unavailable" || !d.wclReportMatched
          ? "selected_run_parse_unavailable"
          : "execution_percentile_missing";
    } else if (keyDiff.percentile == null) {
      unavailableReason = keyDiff.reason ?? "key_difficulty_unavailable";
    }

    const dungeonConfidence =
      runPerformance == null
        ? 0
        : clamp01(
            0.55 * (execution != null ? 1 : 0) +
              0.35 * keyDiff.confidence +
              0.1 * clamp01(d.wclCoverageRatio ?? (d.wclReportMatched ? 0.5 : 0)),
          );

    const sourceParts = [
      execution != null
        ? d.bracketMatched
          ? "wcl_selected_fight_bracket"
          : "wcl_selected_fight"
        : "execution_missing",
      keyDiff.source,
    ];

    return {
      dungeonSlug: d.dungeonSlug,
      dungeonName: d.dungeonName,
      canonicalRunId: d.canonicalRunId,
      keyLevel: d.keyLevel,
      timed: d.timed,
      completedAt: d.completedAt,
      executionPercentile: execution,
      keyDifficultyPercentile: keyDiff.percentile,
      runPerformance,
      confidence: dungeonConfidence,
      source: sourceParts.join("+"),
      keyDifficultySource: keyDiff.percentile != null ? keyDiff.source : null,
      unavailableReason,
    };
  });

  const scored = dungeons.filter(
    (d) => d.runPerformance != null && Number.isFinite(d.runPerformance),
  );
  const performanceScore = meanOfValid(scored.map((d) => d.runPerformance));
  const meanExecutionPercentile = meanOfValid(
    dungeons.map((d) => d.executionPercentile),
  );
  const meanKeyDifficultyPercentile = meanOfValid(
    dungeons.map((d) => d.keyDifficultyPercentile),
  );

  const keyConfidences = dungeons
    .map((d) =>
      d.keyDifficultyPercentile != null && d.keyDifficultySource
        ? d.confidence
        : null,
    )
    .filter((v): v is number => v != null);
  const keyDifficultyConfidenceMean =
    keyConfidences.length > 0
      ? keyConfidences.reduce((s, v) => s + v, 0) / keyConfidences.length
      : 0;

  const confidence = computePerformanceV3Confidence({
    dungeonCountWithScore: scored.length,
    expectedDungeonCount: input.expectedDungeonCount,
    dungeonsWithExecution: dungeons.filter((d) => d.executionPercentile != null)
      .length,
    dungeonsWithKeyDifficulty: dungeons.filter(
      (d) => d.keyDifficultyPercentile != null,
    ).length,
    keyDifficultyConfidenceMean,
    selectedRunWclCoverage: input.selectedRunWclCoverage,
    logFreshness: input.logFreshness ?? (scored.length > 0 ? 0.75 : 0),
    hasResolvedSpecAndRole: input.hasResolvedSpecAndRole,
  });

  return {
    performanceScore,
    meanExecutionPercentile,
    meanKeyDifficultyPercentile,
    confidence,
    dungeonCount: scored.length,
    expectedDungeonCount: input.expectedDungeonCount,
    dungeons,
    formulaVersion: PERFORMANCE_V3_FORMULA_VERSION,
    observations: {
      runPerformance: performanceScore,
      execution: meanExecutionPercentile,
      keyDifficulty: meanKeyDifficultyPercentile,
    },
  };
}
