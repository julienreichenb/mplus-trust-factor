import type {
  DimensionExplainabilityV1,
  ScoreDriverV1,
} from "@mplus/contracts";
import { confidenceBandFromUnit } from "../../confidence/dimension-confidence.js";
import {
  EXPERIENCE_PHASE1_ELITE_FLOOR,
  EXPERIENCE_PHASE1_NO_ACTIVITY_SCORE,
  type ExperiencePhase1Result,
} from "../../experience/phase1/calculate.js";
import type { NativeCutoffBand } from "../../experience/phase1/season-population-policy.js";
import {
  buildConfidenceReasonsFromCauses,
  buildScoreDriver,
  sortDrivers,
} from "../helpers.js";

function availabilityFromExperience(
  result: ExperiencePhase1Result,
): DimensionExplainabilityV1["availability"] {
  if (!result.available || result.score == null) return "UNAVAILABLE";
  return "AVAILABLE";
}

function nativeBandPublicLabel(band: NativeCutoffBand | null | undefined): string {
  switch (band) {
    case "p999":
      return "top 0.1%";
    case "p990":
      return "top 1%";
    case "p900":
      return "top 10%";
    case "p750":
      return "top 25%";
    case "p600":
      return "top 40%";
    case "below_p600":
      return "below top 40%";
    default:
      return "historical";
  }
}

function seasonPublicLabel(result: ExperiencePhase1Result): string {
  const slug =
    result.winningHistoricalProof?.policySeasonSlug ??
    result.standingProvenance?.winningSeasonSlug ??
    result.standingProvenance?.exactHistoricalSeasonSlug;
  if (!slug) return "a prior Mythic+ season";
  // Prefer human-ish labels for known RIO slugs; otherwise keep slug.
  const known: Record<string, string> = {
    "season-tww-3": "The War Within Season 3",
    "season-tww-2": "The War Within Season 2",
    "season-tww-1": "The War Within Season 1",
    "season-df-4": "Dragonflight Season 4",
    "season-df-3": "Dragonflight Season 3",
    "season-df-2": "Dragonflight Season 2",
    "season-df-1": "Dragonflight Season 1",
    "season-sl-4": "Shadowlands Season 4",
    "season-sl-3": "Shadowlands Season 3",
  };
  return known[slug] ?? slug;
}

export function adaptExperienceExplainability(
  result: ExperiencePhase1Result | null | undefined,
): DimensionExplainabilityV1 {
  if (result == null) {
    return {
      dimension: "EXPERIENCE",
      score: null,
      availability: "UNAVAILABLE",
      scoreStory: { drivers: [] },
      confidenceStory: {
        value: null,
        band: null,
        reasons: buildConfidenceReasonsFromCauses(["no_usable_evidence"], {
          confidenceValue: 0,
        }),
        components: [],
      },
    };
  }

  const availability = availabilityFromExperience(result);
  if (availability === "UNAVAILABLE") {
    return {
      dimension: "EXPERIENCE",
      score: null,
      availability: "UNAVAILABLE",
      scoreStory: { drivers: [] },
      confidenceStory: {
        value: result.confidence,
        band: null,
        reasons: buildConfidenceReasonsFromCauses(result.confidenceCauses, {
          confidenceValue: result.confidence ?? 0,
        }),
        components: [],
      },
    };
  }

  const finalScore = result.score!;
  const drivers: ScoreDriverV1[] = [];

  const historical =
    result.historicalStandingScore ?? result.previousStandingScore;
  const classRank = result.classRankFloor;
  const eliteFloor =
    result.confirmedEliteTitleCount > 0 ? EXPERIENCE_PHASE1_ELITE_FLOOR : null;

  const isConfirmedNoActivityOnly =
    historical === EXPERIENCE_PHASE1_NO_ACTIVITY_SCORE &&
    finalScore === EXPERIENCE_PHASE1_NO_ACTIVITY_SCORE &&
    !result.classRankFloorApplied &&
    !result.eliteFloorApplied;

  if (isConfirmedNoActivityOnly) {
    drivers.push(
      buildScoreDriver({
        code: "experience.confirmed_no_activity",
        direction: "NEUTRAL",
        value: EXPERIENCE_PHASE1_NO_ACTIVITY_SCORE,
        weight: null,
        contribution: null,
        materiality: 100,
        params: {
          determinedFinalScore: true,
          confidence: 1,
          confirmedNoActivity: true,
        },
      }),
    );
  } else {
    const pushProof = (
      code: string,
      value: number | null,
      determined: boolean,
      extra: Record<string, string | number | boolean | null> = {},
    ) => {
      if (value == null || !Number.isFinite(value)) return;
      drivers.push(
        buildScoreDriver({
          code,
          direction: determined
            ? value > 0
              ? "POSITIVE"
              : "NEGATIVE"
            : "NEUTRAL",
          value,
          weight: null,
          contribution: null,
          materiality: determined ? Math.max(1, value) : Math.max(0.1, value * 0.1),
          params: {
            determinedFinalScore: determined,
            ...extra,
          },
          evidence: {
            standingProvenance: result.standingProvenance ?? null,
            winningHistoricalProof: result.winningHistoricalProof ?? null,
            contextualizedHistoricalSeasonCount:
              result.contextualizedHistoricalSeasonCount ?? null,
          },
        }),
      );
    };

    if (historical != null) {
      const band =
        result.winningHistoricalProof?.nativeBand ??
        result.standingProvenance?.matchedNativeBand ??
        null;
      pushProof(
        "experience.historical_standing",
        historical,
        historical === finalScore,
        {
          ratingSource: result.standingProvenance?.ratingSource ?? null,
          nativeBand: band,
          nativeBandLabel: nativeBandPublicLabel(band),
          seasonLabel: seasonPublicLabel(result),
          historicalRating: result.standingProvenance?.historicalRating ?? null,
          contextualizedHistoricalSeasonCount:
            result.contextualizedHistoricalSeasonCount ?? 0,
        },
      );
    }
    if (classRank != null) {
      pushProof(
        "experience.class_rank_floor",
        classRank,
        result.classRankFloorApplied || classRank === finalScore,
        {
          classRankFloorApplied: result.classRankFloorApplied,
          classRank: result.previousRegionalClassRank ?? null,
        },
      );
    }
    if (eliteFloor != null) {
      pushProof(
        "experience.elite_title_floor",
        eliteFloor,
        result.eliteFloorApplied || eliteFloor === finalScore,
        {
          eliteFloorApplied: result.eliteFloorApplied,
          confirmedEliteTitleCount: result.confirmedEliteTitleCount,
        },
      );
    }
  }

  const confidenceValue = result.confidence;
  return {
    dimension: "EXPERIENCE",
    score: finalScore,
    availability: "AVAILABLE",
    scoreStory: { drivers: sortDrivers(drivers) },
    confidenceStory: {
      value: confidenceValue,
      band:
        confidenceValue != null && Number.isFinite(confidenceValue)
          ? confidenceBandFromUnit(confidenceValue)
          : null,
      reasons: buildConfidenceReasonsFromCauses(result.confidenceCauses, {
        confidenceValue,
      }),
      components: [],
    },
  };
}
