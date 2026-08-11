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

  if (
    result.healingParseScore != null &&
    Number.isFinite(result.healingParseScore) &&
    result.weightsApplied.healingParse > 0
  ) {
    drivers.push(
      buildScoreDriver({
        code: "performance.healing_parse",
        value: result.healingParseScore,
        weight: result.weightsApplied.healingParse,
        contribution: signedContributionFromNeutral(
          result.healingParseScore,
          result.weightsApplied.healingParse,
        ),
        params: {
          dungeonCount: result.coverage.healingDungeonCount,
        },
        evidence: {
          activeDungeonCount: result.coverage.activeDungeonCount,
        },
      }),
    );
  }

  if (
    result.damageParseScore != null &&
    Number.isFinite(result.damageParseScore) &&
    result.weightsApplied.damageParse > 0
  ) {
    drivers.push(
      buildScoreDriver({
        code: "performance.damage_parse",
        value: result.damageParseScore,
        weight: result.weightsApplied.damageParse,
        contribution: signedContributionFromNeutral(
          result.damageParseScore,
          result.weightsApplied.damageParse,
        ),
        params: {
          dungeonCount: result.coverage.damageDungeonCount,
        },
        evidence: {
          activeDungeonCount: result.coverage.activeDungeonCount,
        },
      }),
    );
  }

  if (
    result.offensiveCooldownDiscipline != null &&
    Number.isFinite(result.offensiveCooldownDiscipline) &&
    result.weightsApplied.cooldown > 0
  ) {
    drivers.push(
      buildScoreDriver({
        code: "performance.offensive_cooldown_discipline",
        value: result.offensiveCooldownDiscipline,
        weight: result.weightsApplied.cooldown,
        contribution: signedContributionFromNeutral(
          result.offensiveCooldownDiscipline,
          result.weightsApplied.cooldown,
        ),
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
