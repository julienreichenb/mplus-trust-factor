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

  const previous = result.previousStandingScore;
  const classRank = result.classRankFloor;
  const eliteFloor =
    result.confirmedEliteTitleCount > 0 ? EXPERIENCE_PHASE1_ELITE_FLOOR : null;

  const isConfirmedNoActivityOnly =
    previous === EXPERIENCE_PHASE1_NO_ACTIVITY_SCORE &&
    finalScore === EXPERIENCE_PHASE1_NO_ACTIVITY_SCORE &&
    !result.classRankFloorApplied &&
    !result.eliteFloorApplied;

  if (isConfirmedNoActivityOnly) {
    drivers.push(
      buildScoreDriver({
        code: "experience.confirmed_no_activity",
        direction: "NEGATIVE",
        value: EXPERIENCE_PHASE1_NO_ACTIVITY_SCORE,
        weight: null,
        contribution: null,
        materiality: 100,
        params: {
          determinedFinalScore: true,
          confidence: 1,
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
          },
        }),
      );
    };

    if (previous != null) {
      pushProof(
        "experience.previous_standing",
        previous,
        previous === finalScore,
        {
          ratingSource: result.standingProvenance?.ratingSource ?? null,
          nativeBand: result.standingProvenance?.matchedNativeBand ?? null,
        },
      );
    }
    if (classRank != null) {
      pushProof(
        "experience.class_rank_floor",
        classRank,
        result.classRankFloorApplied || classRank === finalScore,
        { classRankFloorApplied: result.classRankFloorApplied },
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

  // Confidence 1 → no confidence reasons (score facts live in scoreStory).
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
