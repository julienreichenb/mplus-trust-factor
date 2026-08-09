import type {
  DimensionExplainabilityV1,
  ScoreDriverV1,
} from "@mplus/contracts";
import type { PerformancePhase2ComputeResult } from "../../performance/phase2/types.js";
import {
  buildConfidenceComponents,
  buildConfidenceReasonsFromCauses,
  buildScoreDriver,
  signedContributionFromNeutral,
  sortDrivers,
} from "../helpers.js";

export function adaptPerformanceExplainability(
  result: PerformancePhase2ComputeResult | null | undefined,
): DimensionExplainabilityV1 {
  if (result == null) {
    return {
      dimension: "PERFORMANCE",
      score: null,
      availability: "UNAVAILABLE",
      scoreStory: { drivers: [] },
      confidenceStory: {
        value: null,
        band: null,
        reasons: buildConfidenceReasonsFromCauses(["performance_unavailable"], {
          confidenceValue: 0,
        }),
        components: [],
      },
    };
  }

  const drivers: ScoreDriverV1[] = [];
  const phase1Weight = result.weightsApplied.phase1;
  if (
    result.phase1Score != null &&
    Number.isFinite(result.phase1Score) &&
    phase1Weight > 0
  ) {
    const contribution = signedContributionFromNeutral(
      result.phase1Score,
      phase1Weight,
    );
    drivers.push(
      buildScoreDriver({
        code: "performance.phase1_score",
        value: result.phase1Score,
        weight: phase1Weight,
        contribution,
        params: { phase: 1 },
        evidence: {
          // Supporting Phase-1 detail — not a second primary contribution.
          detailedDungeonCount: result.coverage.detailedDungeonCount,
          profileDungeonCount: result.coverage.profileDungeonCount,
          activeDungeonCount: result.coverage.activeDungeonCount,
        },
      }),
    );
  }

  const cooldownWeight = result.weightsApplied.cooldown;
  if (
    result.offensiveCooldownDiscipline != null &&
    Number.isFinite(result.offensiveCooldownDiscipline) &&
    cooldownWeight > 0
  ) {
    const contribution = signedContributionFromNeutral(
      result.offensiveCooldownDiscipline,
      cooldownWeight,
    );
    drivers.push(
      buildScoreDriver({
        code: "performance.offensive_cooldown_discipline",
        value: result.offensiveCooldownDiscipline,
        weight: cooldownWeight,
        contribution,
        params: {
          evaluatedAbilityCount: result.coverage.evaluatedAbilityCount,
          cooldownUsableRunCount: result.coverage.cooldownUsableRunCount,
        },
        evidence: {
          selectedRunCount: result.coverage.selectedRunCount,
        },
      }),
    );
  }

  const breakdown = result.confidenceBreakdown;
  return {
    dimension: "PERFORMANCE",
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
