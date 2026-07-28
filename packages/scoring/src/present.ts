import type { DimensionDataState, DimensionScoreDTO, ScoreDimension } from "@mplus/contracts";
import type { DimensionScoreResult } from "./types.js";

export interface PresentDimensionOptions {
  /** Refresh still running — all dimensions PROCESSING until finalization. */
  processing?: boolean;
  /** Per-dimension hard error override. */
  errorReason?: string | null;
}

/**
 * Map internal dimension engine results to public DTO semantics.
 * Internal confidenceNeutralScore (e.g. 50 @ confidence 0) must not appear as an observed score.
 */
export function presentDimensionScore(
  result: DimensionScoreResult,
  options: PresentDimensionOptions = {},
): DimensionScoreDTO {
  const base = {
    dimension: result.dimension as ScoreDimension,
    weight: result.weight,
    contributors: {
      available: result.contributors,
      missing: result.missing,
      rawScore: result.rawScore,
      coverage: result.coverage,
      internalAdjustedScore: result.adjustedScore,
    },
  };

  if (options.processing) {
    return {
      ...base,
      score: null,
      confidence: 0,
      state: "PROCESSING",
      reason: "ANALYSIS_IN_PROGRESS",
    };
  }

  if (options.errorReason) {
    return {
      ...base,
      score: null,
      confidence: 0,
      state: "ERROR",
      reason: options.errorReason,
    };
  }

  const hasEvidence = result.contributors.length > 0 && result.confidence > 0;
  if (!hasEvidence) {
    return {
      ...base,
      score: null,
      confidence: 0,
      state: "UNAVAILABLE",
      reason: result.missing.length > 0 ? "NO_OBSERVATIONS" : "NEUTRAL_FALLBACK_HIDDEN",
    };
  }

  const state: DimensionDataState =
    result.coverage < 0.5 || result.confidence < 0.35 ? "PARTIAL" : "AVAILABLE";

  return {
    ...base,
    score: result.adjustedScore,
    confidence: result.confidence,
    state,
    reason: state === "PARTIAL" ? "INCOMPLETE_COVERAGE" : null,
  };
}

export function presentDimensionScores(
  results: DimensionScoreResult[],
  options: PresentDimensionOptions = {},
): DimensionScoreDTO[] {
  return results.map((r) => presentDimensionScore(r, options));
}
