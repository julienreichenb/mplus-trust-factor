import type {
  DimensionExplainabilityV1,
  ScoreDriverV1,
} from "@mplus/contracts";
import type { UtilityV2ComputeResult } from "../../utility/v2/types.js";
import {
  buildConfidenceComponents,
  buildConfidenceReasonsFromCauses,
  buildScoreDriver,
  sortDrivers,
} from "../helpers.js";

const DOMAIN_CODES = {
  castStops: "utility.domain.castStops",
  support: "utility.domain.support",
  strategicCc: "utility.domain.strategicCc",
} as const;

export function adaptUtilityExplainability(
  result: UtilityV2ComputeResult | null | undefined,
): DimensionExplainabilityV1 {
  if (result == null) {
    return {
      dimension: "UTILITY",
      score: null,
      availability: "UNAVAILABLE",
      scoreStory: { drivers: [] },
      confidenceStory: {
        value: null,
        band: null,
        reasons: buildConfidenceReasonsFromCauses(["unavailable"], {
          confidenceValue: 0,
        }),
        components: [],
      },
    };
  }

  const drivers: ScoreDriverV1[] = [];
  for (const domain of result.domainBreakdown) {
    // Non-applicable domains are not weaknesses.
    if (!domain.applicable) continue;

    const code = DOMAIN_CODES[domain.domain];
    const contribution = domain.cappedContribution;
    const events = domain.creditedEvents;
    const isZeroContribution = Math.abs(contribution) < 1e-9;

    drivers.push(
      buildScoreDriver({
        code,
        direction: isZeroContribution
          ? "NEUTRAL"
          : contribution > 0
            ? "POSITIVE"
            : "NEUTRAL",
        value: domain.rawScore,
        weight: domain.weightShare,
        contribution: isZeroContribution ? 0 : contribution,
        materiality: isZeroContribution ? 0 : Math.abs(contribution),
        params: {
          domain: domain.domain,
          applicable: true,
          events,
          cappedContribution: contribution,
          zeroObservedContribution: isZeroContribution,
        },
        evidence: {
          uncappedContribution: domain.uncappedContribution,
          capApplied: domain.capApplied,
          perCombatHour: domain.perCombatHour,
          // notes may mention neutrality; never treat as fabricated penalty
          notes: domain.notes.slice(0, 8),
        },
      }),
    );
  }

  // Reliability attenuation actually changes the score when reliability < 1.
  if (
    result.reliability != null &&
    result.rawBehaviorEstimate != null &&
    result.score != null &&
    Number.isFinite(result.reliability) &&
    result.reliability < 1 - 1e-9
  ) {
    const attenuation =
      result.score - result.rawBehaviorEstimate;
    drivers.push(
      buildScoreDriver({
        code: "utility.reliability_attenuation",
        direction: "NEUTRAL",
        value: result.reliability,
        weight: null,
        contribution: attenuation,
        materiality: Math.abs(attenuation),
        params: {
          reliability: result.reliability,
          rawBehaviorEstimate: result.rawBehaviorEstimate,
          finalScore: result.score,
        },
      }),
    );
  }

  const breakdown = result.confidenceBreakdown;
  return {
    dimension: "UTILITY",
    score: result.score,
    availability: result.availabilityState,
    scoreStory: { drivers: sortDrivers(drivers) },
    confidenceStory: {
      value: breakdown.value,
      band: breakdown.band,
      reasons: buildConfidenceReasonsFromCauses(breakdown.causes, {
        confidenceValue: breakdown.value,
      }),
      components: buildConfidenceComponents(breakdown.components),
    },
  };
}
