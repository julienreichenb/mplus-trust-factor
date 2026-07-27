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
 * Builds a Blizzard Mythic+ rating observation as EXPERIENCE/progression context.
 * Never labels raw rating as a parse percentile or PERFORMANCE execution quality.
 */
export function buildMythicRatingObservation(
  input: MythicRatingObservationInput,
): MetricObservationDTO {
  const ceiling = input.heuristicCeiling ?? 3600;
  const top25 = input.cutoffs?.top25Percent?.score ?? null;

  if (top25 != null && top25 > 0) {
    // Map rating relative to documented top-25% cutoff for progression context only.
    const normalizedValue = clamp01(input.mythicRating / (top25 / 0.75)) * 100;
    return {
      metricKey: "experience.mythic_rating",
      dimension: "EXPERIENCE",
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
        notAParsePercentile: true,
        raiderIoScoreKeptSeparate: true,
      },
    };
  }

  return {
    metricKey: "experience.mythic_rating",
    dimension: "EXPERIENCE",
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
      notAParsePercentile: true,
      warning: "Season cutoffs unavailable; using documented heuristic ceiling, not a percentile.",
      raiderIoScoreKeptSeparate: true,
    },
  };
}
