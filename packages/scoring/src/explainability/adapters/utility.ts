import type {
  DimensionExplainabilityV1,
  ScoreDriverV1,
} from "@mplus/contracts";
import type { UtilityV2ComputeResult } from "../../utility/v2/types.js";
import { UTILITY_V2_FAMILY_KEYS, type UtilityV2FamilyKey } from "../../utility/v2/families.js";
import {
  buildConfidenceComponents,
  buildConfidenceReasonsFromCauses,
  buildScoreDriver,
  sortDrivers,
} from "../helpers.js";

const FAMILY_CODES: Record<UtilityV2FamilyKey, string> = {
  interrupt: "utility.family.interrupt",
  crowdControl: "utility.family.crowdControl",
  dispelPurge: "utility.family.dispelPurge",
  groupSupport: "utility.family.groupSupport",
  movement: "utility.family.movement",
  combatRes: "utility.family.combatRes",
  bloodlust: "utility.family.bloodlust",
};

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
  const unused = new Set(result.explanation.unusedDomains ?? []);
  const uncertain = new Set(
    (result.explanation.uncertainDomains ?? []).map((e) => e.domain),
  );

  for (const domain of result.domainBreakdown) {
    const family = domain.domain as UtilityV2FamilyKey;
    if (!UTILITY_V2_FAMILY_KEYS.includes(family)) continue;
    // Not-applicable / uncertain families are coverage facts, not weaknesses.
    if (!domain.applicable) continue;

    const raw = domain.rawScore ?? 0;
    const unusedFamily = unused.has(family) || domain.creditedEvents <= 0;
    const contribution = domain.weightShare * (raw - 50);
    const direction = unusedFamily
      ? "NEGATIVE"
      : raw >= 60
        ? "POSITIVE"
        : raw <= 40
          ? "NEGATIVE"
          : "NEUTRAL";

    drivers.push(
      buildScoreDriver({
        code: FAMILY_CODES[family],
        direction,
        value: domain.rawScore,
        weight: domain.weightShare,
        contribution,
        materiality: Math.max(Math.abs(contribution), unusedFamily ? domain.weightShare * 50 : 0),
        params: {
          domain: family,
          applicable: true,
          events: domain.creditedEvents,
          unused: unusedFamily,
          cappedContribution: domain.cappedContribution,
          zeroObservedContribution: unusedFamily,
        },
        evidence: {
          uncappedContribution: domain.uncappedContribution,
          capApplied: domain.capApplied,
          perCombatHour: domain.perCombatHour,
          notes: domain.notes.slice(0, 8),
        },
      }),
    );
  }

  for (const row of result.explanation.uncertainDomains ?? []) {
    drivers.push(
      buildScoreDriver({
        code: "utility.applicability_uncertain",
        direction: "NEUTRAL",
        value: null,
        weight: 0,
        contribution: 0,
        materiality: 0,
        params: {
          domain: row.domain,
          reason: row.reason,
          notAWeakness: true,
        },
      }),
    );
  }

  if (
    result.interruptCounts &&
    (result.interruptCounts.CONFIRMED_SUCCESS > 0 ||
      result.interruptCounts.VALID_OVERLAP > 0 ||
      result.interruptCounts.MATCHED_FAILED > 0)
  ) {
    drivers.push(
      buildScoreDriver({
        code: "utility.interrupt_attempt_credit",
        direction: "POSITIVE",
        value: result.interruptCounts.creditedTotal,
        weight: null,
        contribution: null,
        materiality: 0.5,
        params: {
          confirmedSuccess: result.interruptCounts.CONFIRMED_SUCCESS,
          validOverlap: result.interruptCounts.VALID_OVERLAP,
          matchedFailed: result.interruptCounts.MATCHED_FAILED,
          unmatchedAttempt: result.interruptCounts.UNMATCHED_ATTEMPT,
        },
      }),
    );
  }

  void uncertain;

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
