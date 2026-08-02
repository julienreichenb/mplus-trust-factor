import { clamp } from "../../math.js";
import type { SurvivalV2RelativeDamageMode } from "./constants.js";
import type {
  SurvivalV2RelativeDamageFact,
  SurvivalV2RelativeDamageShadow,
  SurvivalV2RelativeReliability,
} from "./types.js";

const MIN_MECHANIC_COVERAGE = 0.5;

/**
 * Relative avoidable damage — diagnostics only unless mode === "active".
 * Always reports publicContribution: 0 for shadow/off (Phase 1 default).
 */
export function scoreSurvivalV2RelativeDamageShadow(input: {
  fact: SurvivalV2RelativeDamageFact | null | undefined;
  mode: SurvivalV2RelativeDamageMode;
}): SurvivalV2RelativeDamageShadow {
  const mode = input.mode;
  const fact = input.fact;
  const base = {
    mode,
    publicContribution: 0 as const,
  };

  if (fact == null) {
    return {
      ...base,
      reliability: "INSUFFICIENT",
      score: null,
      reasons: ["relative_damage_fact_missing"],
      evidence: {},
    };
  }

  if (fact.role === "TANK") {
    return {
      ...base,
      reliability: "EXCLUDED_ROLE",
      score: null,
      reasons: ["tank_excluded_from_relative_damage"],
      evidence: { role: fact.role },
    };
  }

  const reasons: string[] = [...(fact.limitations ?? [])];
  let reliability: SurvivalV2RelativeReliability = "RELIABLE";

  if (!fact.selfDamageExcluded) {
    reasons.push("self_damage_not_excluded");
    reliability = "UNRELIABLE";
  }
  if (!fact.mandatoryDamageExcluded) {
    reasons.push("mandatory_damage_not_excluded");
    reliability = "UNRELIABLE";
  }
  if (fact.mechanicExclusionCoverage < MIN_MECHANIC_COVERAGE) {
    reasons.push("mechanic_exclusion_coverage_insufficient");
    reliability = "UNRELIABLE";
  }
  if (
    fact.targetDamagePerActiveSecond == null ||
    fact.nonTankGroupMedianPerActiveSecond == null ||
    !(fact.nonTankGroupMedianPerActiveSecond > 0)
  ) {
    reasons.push("group_median_or_target_dps_missing");
    reliability = "INSUFFICIENT";
  }

  if (reliability !== "RELIABLE") {
    return {
      ...base,
      reliability,
      score: null,
      reasons,
      evidence: {
        role: fact.role,
        mechanicExclusionCoverage: fact.mechanicExclusionCoverage,
        selfDamageExcluded: fact.selfDamageExcluded,
        mandatoryDamageExcluded: fact.mandatoryDamageExcluded,
        passiveMitigationCaveat: fact.passiveMitigationCaveat ?? null,
      },
    };
  }

  const ratio =
    fact.targetDamagePerActiveSecond! / fact.nonTankGroupMedianPerActiveSecond!;
  // Lower damage vs group median → higher score. Cap influence.
  const score = clamp(100 * (2 - ratio), 0, 100);

  return {
    ...base,
    reliability: "RELIABLE",
    score,
    reasons:
      mode === "active"
        ? reasons
        : [...reasons, "shadow_or_off_zero_public_contribution"],
    evidence: {
      role: fact.role,
      ratio,
      targetDamagePerActiveSecond: fact.targetDamagePerActiveSecond,
      nonTankGroupMedianPerActiveSecond: fact.nonTankGroupMedianPerActiveSecond,
      mechanicExclusionCoverage: fact.mechanicExclusionCoverage,
      passiveMitigationCaveat: fact.passiveMitigationCaveat ?? null,
    },
  };
}

/**
 * Whether relative damage participates in weight renormalization / run blend.
 * A reliable score of 0 is valid and must keep its configured weight.
 */
export function isSurvivalV2RelativeDamageWeightActive(
  mode: SurvivalV2RelativeDamageMode,
  shadow: Pick<SurvivalV2RelativeDamageShadow, "reliability" | "score">,
): boolean {
  return (
    mode === "active" && shadow.reliability === "RELIABLE" && shadow.score != null
  );
}

/**
 * Score value used in the weighted run blend when weight-active.
 * Returns null when the component is omitted (not when score is legitimately 0).
 */
export function relativeDamageBlendScore(
  shadow: SurvivalV2RelativeDamageShadow,
): number | null {
  if (!isSurvivalV2RelativeDamageWeightActive(shadow.mode, shadow)) return null;
  return shadow.score;
}
