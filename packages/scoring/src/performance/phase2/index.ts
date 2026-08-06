export {
  PERFORMANCE_PHASE2_ALGORITHM_VERSION,
  PERFORMANCE_PHASE2_MODEL_LABEL,
  PERFORMANCE_PHASE2_WEIGHTS,
  PERFORMANCE_PHASE2_END_GRACE_MS_CAP,
  PERFORMANCE_PHASE2_END_GRACE_FRACTION,
} from "./constants.js";

export {
  computeEndGraceMs,
  computeExpectedUses,
  usageRatioToScore,
} from "./expected-uses.js";

export {
  resolveEligibleOffensiveCooldowns,
  type EligibleOffensiveCooldown,
  type SkippedOffensiveCooldown,
  type CooldownEligibilitySkipReason,
} from "./eligibility.js";

export {
  scoreRunCooldownDiscipline,
  computeOffensiveCooldownDiscipline,
  type PerformanceCooldownRunEvidence,
  type AbilityCooldownScore,
  type RunCooldownDisciplineResult,
  type OffensiveCooldownDisciplineResult,
} from "./cooldown-discipline.js";

export {
  computePerformancePhase2,
  computePerformancePhase2InputFingerprint,
  type PerformancePhase2ComputeOptions,
} from "./compute.js";

export { combinePerformancePhase2Scores } from "./combine.js";

export { profileAggregateFactFromPersisted } from "./profile-from-aggregate.js";

export { cooldownRunEvidenceFromDigest } from "./digest-adapter.js";

export type {
  PerformancePhase2ComputeInput,
  PerformancePhase2ComputeResult,
  PerformancePhase2WeightsApplied,
  PerformancePhase2Coverage,
} from "./types.js";
