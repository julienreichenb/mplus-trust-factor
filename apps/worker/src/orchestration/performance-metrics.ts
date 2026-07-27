import type {
  MetricObservationDTO,
  RaiderIoSeasonCutoffs,
} from "@mplus/contracts";

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export interface MythicRatingObservationInput {
  mythicRating: number;
  observedAt: string;
  cutoffs: RaiderIoSeasonCutoffs | null;
  /** Documented seasonal ceiling used only as a transparent heuristic fallback. */
  heuristicCeiling?: number;
}

/**
 * Builds a correctly named Blizzard Mythic rating observation.
 * Never labels raw rating as a percentile. Uses season cutoffs when available;
 * otherwise a transparent bounded heuristic with low confidence.
 */
export function buildMythicRatingObservation(
  input: MythicRatingObservationInput,
): MetricObservationDTO {
  const ceiling = input.heuristicCeiling ?? 3600;
  const top25 = input.cutoffs?.top25Percent?.score ?? null;

  if (top25 != null && top25 > 0) {
    // Map rating relative to documented top-25% cutoff: cutoff ≈ 75th percentile score band.
    const normalizedValue = clamp01(input.mythicRating / (top25 / 0.75)) * 100;
    return {
      metricKey: "performance.mythic_rating",
      dimension: "PERFORMANCE",
      rawValue: input.mythicRating,
      normalizedValue,
      confidence: 0.75,
      observedAt: input.observedAt,
      sourceProvider: "blizzard",
      coverage: null,
      context: {
        source: "mythic-keystone-profile",
        normalization: "season_cutoff_top25",
        cutoffScore: top25,
        cutoffSeasonSlug: input.cutoffs?.seasonSlug ?? null,
        cutoffUpdatedAt: input.cutoffs?.updatedAt ?? null,
        raiderIoScoreKeptSeparate: true,
      },
    };
  }

  return {
    metricKey: "performance.mythic_rating",
    dimension: "PERFORMANCE",
    rawValue: input.mythicRating,
    normalizedValue: clamp01(input.mythicRating / ceiling) * 100,
    confidence: 0.35,
    observedAt: input.observedAt,
    sourceProvider: "blizzard",
    coverage: null,
    context: {
      source: "mythic-keystone-profile",
      normalization: "transparent_heuristic_ceiling",
      heuristicCeiling: ceiling,
      lowConfidence: true,
      warning: "Season cutoffs unavailable; using documented heuristic ceiling, not a percentile.",
      raiderIoScoreKeptSeparate: true,
    },
  };
}
