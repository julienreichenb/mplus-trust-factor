/**
 * Product Performance path — role-aware profile throughput + DPS cooldown.
 * Detailed playerscore Phase1 blend is bypassed (Architecture A / Agent 04B).
 */

import {
  computeRoleAwarePerformance,
  computeRoleAwarePerformanceInputFingerprint,
} from "../role-aware/compute.js";
import {
  PERFORMANCE_ROLE_AWARE_ALGORITHM_VERSION,
  PERFORMANCE_ROLE_AWARE_MODEL_LABEL,
} from "../role-aware/constants.js";
import type {
  PerformancePhase2ComputeInput,
  PerformancePhase2ComputeResult,
} from "./types.js";

export function computePerformancePhase2InputFingerprint(
  input: PerformancePhase2ComputeInput,
): string {
  return computeRoleAwarePerformanceInputFingerprint(input);
}

/**
 * Provider-free Performance product calculator (role-aware).
 */
export function computePerformancePhase2(
  input: PerformancePhase2ComputeInput,
): PerformancePhase2ComputeResult {
  const roleAware = computeRoleAwarePerformance(input);
  const damageParseScore = roleAware.damageParse?.score ?? null;
  const healingParseScore = roleAware.healingParse?.score ?? null;
  const phase1ScoreAlias =
    input.role === "HEALER" ? null : damageParseScore;

  const weightsApplied = {
    phase1:
      input.role === "HEALER"
        ? 0
        : roleAware.weightsApplied.damageParse,
    damageParse: roleAware.weightsApplied.damageParse,
    healingParse: roleAware.weightsApplied.healingParse,
    cooldown: roleAware.weightsApplied.cooldown,
  };

  const profileDungeonCount =
    roleAware.coverage.damageDungeonCount +
    (input.role === "HEALER" ? roleAware.coverage.healingDungeonCount : 0);

  const coverage = {
    activeDungeonCount: roleAware.coverage.activeDungeonCount,
    detailedDungeonCount: 0,
    selectedRunCount: roleAware.coverage.selectedRunCount,
    profileDungeonCount,
    damageDungeonCount: roleAware.coverage.damageDungeonCount,
    healingDungeonCount: roleAware.coverage.healingDungeonCount,
    cooldownUsableRunCount: roleAware.coverage.cooldownUsableRunCount,
    evaluatedAbilityCount: roleAware.coverage.evaluatedAbilityCount,
  };

  const explanation = {
    algorithmVersion: PERFORMANCE_ROLE_AWARE_ALGORITHM_VERSION,
    modelLabel: PERFORMANCE_ROLE_AWARE_MODEL_LABEL,
    contributors: roleAware.contributors,
    selectedRuns: [],
    confidenceLimits: roleAware.limitations,
    phase1Score: phase1ScoreAlias,
    damageParseScore,
    healingParseScore,
    offensiveCooldownDiscipline: roleAware.offensiveCooldownDiscipline,
    weightsApplied,
    cooldown: roleAware.cooldown,
    phase2State: "ACTIVE" as const,
    phase3State: "DEFERRED_CRITICAL_MASS" as const,
    confidenceBreakdown: roleAware.confidenceBreakdown,
  } as unknown as PerformancePhase2ComputeResult["explanation"];

  return {
    state: roleAware.state,
    score: roleAware.score,
    confidence: roleAware.confidence,
    confidenceBreakdown: roleAware.confidenceBreakdown,
    damageParseScore,
    healingParseScore,
    phase1Score: phase1ScoreAlias,
    offensiveCooldownDiscipline: roleAware.offensiveCooldownDiscipline,
    weightsApplied,
    roleAware,
    phase1: null,
    cooldown: roleAware.cooldown,
    detailedRuns: [],
    dungeonScores: [],
    profileSummary: null,
    coverage,
    limitations: roleAware.limitations,
    calculatorVersion: PERFORMANCE_ROLE_AWARE_ALGORITHM_VERSION,
    algorithmVersion: PERFORMANCE_ROLE_AWARE_ALGORITHM_VERSION,
    modelLabel: PERFORMANCE_ROLE_AWARE_MODEL_LABEL,
    inputFingerprint: roleAware.inputFingerprint,
    explanation,
    metrics: {
      role: input.role,
      damageEvidenceCoverage: roleAware.damageParse?.evidenceCoverage ?? 0,
      healingEvidenceCoverage: roleAware.healingParse?.evidenceCoverage ?? 0,
      detailedPlayerscoreScoreNeutral: true,
    },
    contributors: roleAware.contributors,
  };
}
