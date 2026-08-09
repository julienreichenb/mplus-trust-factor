import type {
  DimensionExplainabilityV1,
  ScoreDriverV1,
} from "@mplus/contracts";
import { SURVIVAL_V2_MODEL_CONFIG } from "../../survival/v2/constants.js";
import type { SurvivalV2ComputeResult } from "../../survival/v2/types.js";
import { resolveSurvivalV2Weights } from "../../survival/v2/weights.js";
import {
  buildConfidenceComponents,
  buildConfidenceReasonsFromCauses,
  buildScoreDriver,
  sanitizeEvidenceRecord,
  signedContributionFromNeutral,
  sortDrivers,
} from "../helpers.js";

export function adaptSurvivalExplainability(
  result: SurvivalV2ComputeResult | null | undefined,
): DimensionExplainabilityV1 {
  if (result == null) {
    return {
      dimension: "SURVIVAL",
      score: null,
      availability: "UNAVAILABLE",
      scoreStory: { drivers: [] },
      confidenceStory: {
        value: null,
        band: null,
        reasons: buildConfidenceReasonsFromCauses(["no_survival_evidence"], {
          confidenceValue: 0,
        }),
        components: [],
      },
    };
  }

  const weights = resolveSurvivalV2Weights(
    result.relativeDamageMode,
    {
      outcome: result.components.outcome != null,
      defensive: result.components.defensive != null,
      recovery: result.components.recovery != null,
      relativeDamage:
        result.relativeDamageMode === "active" &&
        result.components.relativeDamage != null,
    },
    SURVIVAL_V2_MODEL_CONFIG,
  );

  const drivers: ScoreDriverV1[] = [];

  const pushComponent = (
    code: string,
    value: number | null,
    weight: number,
    evidence: Record<string, unknown> = {},
  ) => {
    if (value == null || !Number.isFinite(value) || weight <= 0) return;
    const contribution = signedContributionFromNeutral(value, weight);
    drivers.push(
      buildScoreDriver({
        code,
        value,
        weight,
        contribution,
        evidence: sanitizeEvidenceRecord(evidence),
      }),
    );
  };

  pushComponent("survival.outcome", result.components.outcome, weights.outcome);
  pushComponent(
    "survival.defensive_response",
    result.components.defensive,
    weights.defensive,
  );
  pushComponent(
    "survival.emergency_recovery",
    result.components.recovery,
    weights.recovery,
  );

  if (result.relativeDamageMode === "active") {
    pushComponent(
      "survival.relative_avoidable_damage",
      result.components.relativeDamage,
      weights.relativeDamage,
      { mode: result.relativeDamageMode },
    );
  } else if (result.components.relativeDamage != null) {
    // Shadow relative damage is audit context only — never a public score driver.
    // Kept only as evidence on a NEUTRAL audit-tagged note via empty contribution skip.
  }

  const breakdown = result.confidenceBreakdown;
  return {
    dimension: "SURVIVAL",
    score: result.score,
    availability: result.state,
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
