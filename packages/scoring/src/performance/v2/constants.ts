/**
 * Performance V2 Phase 1 — immutable model config and version stamps.
 *
 * Coefficients are candidate defaults from the normative Performance scoring
 * spec. Calibration status is documented; values are not product-activated.
 */

export const PERFORMANCE_V2_SCHEMA_VERSION = "performance-v2" as const;
export const PERFORMANCE_V2_ALGORITHM_VERSION = "performance-v2.phase1.0.1.0" as const;
export const PERFORMANCE_V2_MODEL_LABEL = "v2-phase1" as const;

/** Calibration lifecycle for this coefficient set (not a live ScoreModel). */
export type PerformanceV2CalibrationStatus =
  | "CANDIDATE_DEFAULTS_UNCALIBRATED"
  | "CALIBRATION_IN_PROGRESS"
  | "CALIBRATED_SHADOW"
  | "CALIBRATED_ACTIVE";

export const PERFORMANCE_V2_CALIBRATION_STATUS: PerformanceV2CalibrationStatus =
  "CANDIDATE_DEFAULTS_UNCALIBRATED";

/** Writable/validated shape — numeric fields are `number` so overrides can differ from defaults. */
export type PerformanceV2ModelConfig = {
  schemaVersion: typeof PERFORMANCE_V2_SCHEMA_VERSION;
  algorithmVersion: string;
  modelLabel: string;
  calibrationStatus: PerformanceV2CalibrationStatus;
  lowKeyBaseline: number;
  difficultyMultipliers: {
    atOrBelowLowBaseline: number;
    atK50: number;
    atK90: number;
    atK99: number;
    aboveK99Cap: number;
  };
  parseCenter: number;
  dungeonWeights: { peak: number; floor: number; consistency: number };
  profileWeights: { bestAverage: number; medianAverage: number };
  blend: {
    detailedWeightFloor: number;
    detailedWeightSlope: number;
    detailedWeightCoverageExponent: number;
    detailedWeightCap: number;
  };
  oneRunDungeonConfidenceCap: number;
  role: {
    dpsFieldValidated: boolean;
    tankAdapterVerified: boolean;
    healerAdapterVerified: boolean;
  };
  confidenceWeights: {
    dungeonCoverage: number;
    slotCoverage: number;
    twoRunShare: number;
    profileAvailability: number;
    adapterValidity: number;
    partitionCompatibility: number;
    freshness: number;
    policyConfidence: number;
  };
  loggedRunCountContextualWeight: number;
  profileDisagreementDiagnosticThreshold: number;
};

/**
 * Immutable Phase 1 coefficient bundle.
 * Do not mutate at runtime; clone a new versioned object for calibration.
 */
export const PERFORMANCE_V2_MODEL_CONFIG: PerformanceV2ModelConfig = Object.freeze({
  schemaVersion: PERFORMANCE_V2_SCHEMA_VERSION,
  algorithmVersion: PERFORMANCE_V2_ALGORITHM_VERSION,
  modelLabel: PERFORMANCE_V2_MODEL_LABEL,
  calibrationStatus: PERFORMANCE_V2_CALIBRATION_STATUS,

  /** Mythic+ floor key used as the low-season baseline knot. */
  lowKeyBaseline: 2,

  /** Difficulty multiplier knots (interpolated linearly; capped above k99). */
  difficultyMultipliers: Object.freeze({
    atOrBelowLowBaseline: 0.75,
    atK50: 0.85,
    atK90: 1.0,
    atK99: 1.12,
    aboveK99Cap: 1.15,
  }),

  /** Neutral parse center before difficulty adjustment. */
  parseCenter: 50,

  /** Two-run dungeon blend weights (must sum to 1). */
  dungeonWeights: Object.freeze({
    peak: 0.4,
    floor: 0.45,
    consistency: 0.15,
  }),

  /** Profile stabilizer weights (must sum to 1). */
  profileWeights: Object.freeze({
    bestAverage: 0.45,
    medianAverage: 0.55,
  }),

  /** Coverage → detailedWeight curve. */
  blend: Object.freeze({
    detailedWeightFloor: 0.25,
    detailedWeightSlope: 0.6,
    detailedWeightCoverageExponent: 1.5,
    detailedWeightCap: 0.85,
  }),

  /** One-run dungeon confidence hard cap. */
  oneRunDungeonConfidenceCap: 0.55,

  /** Role / adapter gates. */
  role: Object.freeze({
    /** DPS parse adapter is field-validated for same-key bracket/rank percentiles. */
    dpsFieldValidated: true,
    /** Tank/healer run-throughput adapters remain unverified in Phase 1. */
    tankAdapterVerified: false,
    healerAdapterVerified: false,
  }),

  /** Confidence component weights (sum ≈ 1 before hard factors). */
  confidenceWeights: Object.freeze({
    dungeonCoverage: 0.22,
    slotCoverage: 0.22,
    twoRunShare: 0.16,
    profileAvailability: 0.1,
    adapterValidity: 0.12,
    partitionCompatibility: 0.08,
    freshness: 0.05,
    policyConfidence: 0.05,
  }),

  /** Soft contextual factor from displayed WCL run count (never substitutes slots). */
  loggedRunCountContextualWeight: 0.03,

  /** Large profile-vs-equal-dungeon disagreement diagnostic threshold (absolute). */
  profileDisagreementDiagnosticThreshold: 15,
});
