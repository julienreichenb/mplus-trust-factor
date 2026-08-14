/**
 * Survival V2 — immutable model coefficients (calibration-candidate).
 * Functional Phase 2 adds contextual defensive / recovery response classes.
 * Shadow/off relative-damage renormalizes to V1.1.1 55/30/15.
 * Active relative-damage uses 50/25/15/10.
 */

/** Bounded fact-document schema version (RunFactSet.facts). */
export const SURVIVAL_V2_SCHEMA_VERSION = "survival-facts-v2.0.0" as const;
/** Calibration / compute export schema (not the fact document schema). */
export const SURVIVAL_V2_CALIBRATION_SCHEMA_VERSION = "survival-v2" as const;
export const SURVIVAL_V2_EXTRACTOR_FAMILY = "survival" as const;
export const SURVIVAL_V2_ALGORITHM_VERSION =
  "survival-v2-phase2-contextual-0.2.1" as const;
export const SURVIVAL_V2_MODEL_LABEL = "survival-v2-phase2-contextual" as const;

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

/**
 * Functional Survival Phase 2 contextual coefficients.
 * Anticipation window matches pressure extractor `beforeLookbackMs` (5s).
 */
export const SURVIVAL_V2_PHASE2 = {
  anticipationWindowMs: 5_000,
  reactiveSlackMs: 500,
  timelyRecoverySlackMs: 3_000,
  defensiveClassScores: {
    ANTICIPATED: 100,
    REACTIVE: 70,
    NO_RESPONSE_AVAILABLE: 15,
  },
  recoveryClassScores: {
    TIMELY_RECOVERY: 100,
    LATE_RECOVERY: 55,
    NO_RECOVERY_AVAILABLE: 15,
  },
} as const;

export type SurvivalV2DefensiveResponseClass =
  | "ANTICIPATED"
  | "REACTIVE"
  | "NO_RESPONSE_AVAILABLE"
  | "NO_TOOL_AVAILABLE"
  | "NOT_OBSERVABLE";

export type SurvivalV2RecoveryResponseClass =
  | "TIMELY_RECOVERY"
  | "LATE_RECOVERY"
  | "NO_RECOVERY_AVAILABLE"
  | "NO_SELF_HEAL_AVAILABLE"
  | "NOT_OBSERVABLE";

export type SurvivalV2RelativeDamageMode = "off" | "shadow" | "active";

/** Writable/validated shape — numeric fields are `number` so overrides can differ from defaults. */
export type SurvivalV2ModelConfig = {
  schemaVersion: typeof SURVIVAL_V2_CALIBRATION_SCHEMA_VERSION;
  algorithmVersion: string;
  modelLabel: string;
  calibrationStatus: SurvivalV2CalibrationStatus;
  outcomeByDeaths: { 0: number; 1: number; 2: number; threeOrMore: number };
  weightsWithRelative: {
    outcome: number;
    defensive: number;
    recovery: number;
    relativeDamage: number;
  };
  weightsShadowOrOff: {
    outcome: number;
    defensive: number;
    recovery: number;
    relativeDamage: number;
  };
  danger: {
    lowHpRatio: number;
    mergeGapMs: number;
    recoverAboveHpRatio: number;
    stableRecoveryMs: number;
    continuousPressureGapMs: number;
  };
  defensiveRate: {
    saturatingK: number;
    applicableCategories: readonly string[];
  };
  metricKeys: {
    outcome: string;
    defensive: string;
    recovery: string;
    relativeDamage: string;
  };
  activeHealing: SurvivalV2ActiveHealingConfig;
};

export type SurvivalV2ActiveHealingCurveKnot = {
  effectiveHealPctMaxHp: number;
  credit: number;
};

export type SurvivalV2ActiveHealingConfig = {
  enabled: boolean;
  minEffectiveHealPctMaxHp: number;
  selfWeight: number;
  allyWeight: number;
  eventCreditCurve: ReadonlyArray<SurvivalV2ActiveHealingCurveKnot>;
  diminishingExponent: number;
  /** Maximum Survival score points added after existing weighted components (0–100). */
  maxSurvivalBonusPoints: number;
};

export const SURVIVAL_V2_ACTIVE_HEALING: SurvivalV2ActiveHealingConfig = Object.freeze({
  enabled: true,
  minEffectiveHealPctMaxHp: 0.08,
  selfWeight: 1,
  allyWeight: 1.15,
  eventCreditCurve: Object.freeze([
    Object.freeze({ effectiveHealPctMaxHp: 0.08, credit: 0.25 }),
    Object.freeze({ effectiveHealPctMaxHp: 0.15, credit: 0.5 }),
    Object.freeze({ effectiveHealPctMaxHp: 0.25, credit: 0.85 }),
    Object.freeze({ effectiveHealPctMaxHp: 0.4, credit: 1.15 }),
    Object.freeze({ effectiveHealPctMaxHp: 1, credit: 1.5 }),
  ]),
  diminishingExponent: 0.75,
  maxSurvivalBonusPoints: 18,
});

/**
 * Immutable Phase 1 coefficient bundle.
 * Do not mutate at runtime; clone a new versioned object for calibration.
 */
export const SURVIVAL_V2_MODEL_CONFIG: SurvivalV2ModelConfig = Object.freeze({
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
  activeHealing: SURVIVAL_V2_ACTIVE_HEALING,
});
