/**
 * Survival V2 Phase 1 — immutable model coefficients (calibration-candidate).
 * Shadow/off relative-damage renormalizes to V1.1.1 55/30/15.
 * Active relative-damage uses 50/25/15/10.
 */

/** Bounded fact-document schema version (RunFactSet.facts). */
export const SURVIVAL_V2_SCHEMA_VERSION = "survival-facts-v2.0.0" as const;
/** Calibration / compute export schema (not the fact document schema). */
export const SURVIVAL_V2_CALIBRATION_SCHEMA_VERSION = "survival-v2" as const;
export const SURVIVAL_V2_EXTRACTOR_FAMILY = "survival" as const;
export const SURVIVAL_V2_ALGORITHM_VERSION = "survival-v2-phase1.0.0" as const;
export const SURVIVAL_V2_MODEL_LABEL = "survival-v2-phase1" as const;

/** Calibration lifecycle for this coefficient set (not a live ScoreModel). */
export type SurvivalV2CalibrationStatus =
  | "CANDIDATE_DEFAULTS_UNCALIBRATED"
  | "CALIBRATION_IN_PROGRESS"
  | "CALIBRATED_SHADOW"
  | "CALIBRATED_ACTIVE";

export const SURVIVAL_V2_CALIBRATION_STATUS: SurvivalV2CalibrationStatus =
  "CANDIDATE_DEFAULTS_UNCALIBRATED";

/** Deaths → outcome score (V1 parity). */
export const SURVIVAL_V2_OUTCOME_BY_DEATHS = {
  0: 100,
  1: 65,
  2: 30,
  threeOrMore: 0,
} as const;

/**
 * Production candidate weights when relative avoidable damage is public-active.
 * Sum = 1.0.
 */
export const SURVIVAL_V2_WEIGHTS_WITH_RELATIVE = {
  outcome: 0.5,
  defensive: 0.25,
  recovery: 0.15,
  relativeDamage: 0.1,
} as const;

/**
 * Renormalized weights while relative damage is shadow or off (V1.1.1 parity).
 * Sum = 1.0.
 */
export const SURVIVAL_V2_WEIGHTS_SHADOW_OR_OFF = {
  outcome: 0.55,
  defensive: 0.3,
  recovery: 0.15,
  relativeDamage: 0,
} as const;

/** Danger / pressure-cluster thresholds (V1.1.1 parity). */
export const SURVIVAL_V2_DANGER = {
  lowHpRatio: 0.35,
  mergeGapMs: 8_000,
  recoverAboveHpRatio: 0.5,
  stableRecoveryMs: 5_000,
  continuousPressureGapMs: 15_000,
} as const;

/**
 * Defensive activation rate → 0–100 saturating curve.
 * rate = applicable activations / active-combat hour.
 * score = 100 * (1 - exp(-k * rate)); k chosen so ~6 act/h ≈ 95.
 * Status: calibration-candidate — not population-fitted.
 */
export const SURVIVAL_V2_DEFENSIVE_RATE = {
  saturatingK: 0.5,
  /** Categories counted toward Phase 1 activation volume. */
  applicableCategories: [
    "DEFENSIVE_MAJOR",
    "DEFENSIVE_MINOR",
    "IMMUNITY",
    "ABSORB",
    "HEALTH_INCREASE",
  ] as const,
} as const;

export const SURVIVAL_V2_METRIC_KEYS = {
  outcome: "survival.outcome",
  defensive: "survival.defensive_response",
  recovery: "survival.emergency_recovery",
  relativeDamage: "survival.relative_avoidable_damage",
} as const;

export type SurvivalV2RelativeDamageMode = "off" | "shadow" | "active";

/**
 * Immutable Phase 1 coefficient bundle.
 * Do not mutate at runtime; clone a new versioned object for calibration.
 */
export const SURVIVAL_V2_MODEL_CONFIG = Object.freeze({
  schemaVersion: SURVIVAL_V2_CALIBRATION_SCHEMA_VERSION,
  algorithmVersion: SURVIVAL_V2_ALGORITHM_VERSION,
  modelLabel: SURVIVAL_V2_MODEL_LABEL,
  calibrationStatus: SURVIVAL_V2_CALIBRATION_STATUS,
  outcomeByDeaths: SURVIVAL_V2_OUTCOME_BY_DEATHS,
  weightsWithRelative: SURVIVAL_V2_WEIGHTS_WITH_RELATIVE,
  weightsShadowOrOff: SURVIVAL_V2_WEIGHTS_SHADOW_OR_OFF,
  danger: SURVIVAL_V2_DANGER,
  defensiveRate: SURVIVAL_V2_DEFENSIVE_RATE,
  metricKeys: SURVIVAL_V2_METRIC_KEYS,
} as const);

export type SurvivalV2ModelConfig = typeof SURVIVAL_V2_MODEL_CONFIG;
