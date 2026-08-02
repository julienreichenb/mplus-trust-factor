/**
 * Utility V2 Phase 1 — observed-positive-contribution model config.
 *
 * Calibration status: candidate defaults from normative Utility scoring spec
 * and Utility V3.2 OBSERVED_CONTRIBUTION panel. Coefficients are immutable here;
 * do not mutate at runtime. Opportunity Mode remains off (Phase 2).
 */

export const UTILITY_V2_SCHEMA_VERSION = "utility-v2-facts";
export const UTILITY_V2_EXTRACTOR_FAMILY = "utility";
export const UTILITY_V2_EXTRACTOR_VERSION = "utility-v2.0.0";
export const UTILITY_V2_ALGORITHM_VERSION = "utility-v2-phase1-observed-0.1.0";
export const UTILITY_V2_MODEL_LABEL = "utility-v2-phase1-observed";
export const UTILITY_V2_CALIBRATION_STATUS = "CANDIDATE_DEFAULTS_UNCALIBRATED" as const;
export type UtilityV2CalibrationStatus = typeof UTILITY_V2_CALIBRATION_STATUS;

/** Domain weights among applicable toolkit domains only (renormalize when N/A). */
export const UTILITY_V2_DOMAIN_WEIGHTS = {
  castStops: 0.45,
  support: 0.28,
  strategicCc: 0.27,
} as const;

export type UtilityV2DomainKey = keyof typeof UTILITY_V2_DOMAIN_WEIGHTS;

/** Absolute cap on share×(raw−50) per domain after weight share. */
export const UTILITY_V2_DOMAIN_CONTRIBUTION_CAP = 8;

/** Neutral floor — Phase 1 never scores below this without opportunity Mode. */
export const UTILITY_V2_SCORE_FLOOR = 50;

/** Cast-stop credit by interrupt attempt class (spec candidate defaults). */
export const UTILITY_V2_INTERRUPT_CREDITS = {
  CONFIRMED_SUCCESS: 1.0,
  VALID_OVERLAP: 0.5,
  MATCHED_FAILED: 0.2,
  UNMATCHED_ATTEMPT: 0.05,
  NOT_OBSERVABLE: 0,
} as const;

/**
 * Cap on unmatched attempt credit share of total cast-stop credit.
 * Unmatched spam alone cannot produce an elite domain score.
 */
export const UTILITY_V2_UNMATCHED_CREDIT_SHARE_CAP = 0.35;

/** Max domain raw score reachable from unmatched-only credit after curve. */
export const UTILITY_V2_UNMATCHED_ONLY_MAX_DOMAIN_SCORE = 62;

/** Match window: interrupt cast ↔ confirmed interrupt / hostile window (ms). */
export const UTILITY_V2_INTERRUPT_MATCH_TOLERANCE_MS = 1_500;

/** CC dedupe: same ability+target within this window counts once. */
export const UTILITY_V2_CC_DEDUPE_WINDOW_MS = 3_000;

export const UTILITY_V2_SUPPORT_SEMANTIC_CREDIT = {
  REACTIVE_SUPPORT: 1,
  STRATEGIC_SUPPORT: 0.9,
  EMERGENCY_SUPPORT: 1,
  ROUTINE_ROTATIONAL_SUPPORT: 0.05,
  PASSIVE_SUPPORT: 0,
  PERSONAL_MOBILITY: 0,
  UNVERIFIED_EXTERNAL: 0,
} as const;

export type UtilityV2SupportSemantic = keyof typeof UTILITY_V2_SUPPORT_SEMANTIC_CREDIT;

export const UTILITY_V2_DISPEL_PURGE_EVENT_CREDIT = 1;

/** Support credit diminishing: effective = raw^exponent. */
export const UTILITY_V2_SUPPORT_DIMINISHING_EXPONENT = 0.75;

export const UTILITY_V2_CAST_STOPS_CURVE = [
  { perHour: 0, score: 50 },
  { perHour: 2, score: 54 },
  { perHour: 5, score: 62 },
  { perHour: 10, score: 70 },
  { perHour: 18, score: 78 },
  { perHour: 28, score: 84 },
  { perHour: 40, score: 88 },
] as const;

export const UTILITY_V2_SUPPORT_CURVE = [
  { perHour: 0, score: 50 },
  { perHour: 1.5, score: 54 },
  { perHour: 4, score: 60 },
  { perHour: 8, score: 66 },
  { perHour: 14, score: 72 },
  { perHour: 22, score: 78 },
  { perHour: 32, score: 82 },
] as const;

export const UTILITY_V2_STRATEGIC_CC_CURVE = [
  { perHour: 0, score: 50 },
  { perHour: 0.5, score: 54 },
  { perHour: 1.5, score: 62 },
  { perHour: 3, score: 70 },
  { perHour: 6, score: 78 },
  { perHour: 10, score: 84 },
  { perHour: 16, score: 88 },
] as const;

/** Hostile begincasts/hour below this soft-reduces cast-stop score toward 50. */
export const UTILITY_V2_MIN_HOSTILE_CASTS_PER_HOUR_FOR_FULL_CREDIT = 40;

export const UTILITY_V2_ACTIVE_COMBAT_GAP_MS = 15_000;

export const UTILITY_V2_CONFIDENCE = {
  expectedDungeons: 8,
  runSaturation: 8,
  combatHourSaturation: 4,
  attributableEventSaturation: 40,
  tinyRunThreshold: 3,
  maxWhenTinySample: 58,
  maxWhenPartialDungeons: 72,
  maxWhenZeroAttributable: 35,
  maxWhenNoHostileCasts: 45,
  maxWhenMechanicCatalogBelow: [
    { below: 0.25, maxConfidence: 70 },
    { below: 0.5, maxConfidence: 78 },
    { below: 0.75, maxConfidence: 85 },
  ],
  weights: {
    dungeonCoverage: 0.2,
    runCoverage: 0.15,
    combatDuration: 0.2,
    attributableEvents: 0.25,
    mechanicCatalogCoverageObserved: 0.1,
    sourceCompleteness: 0.1,
  },
  minReliability: 0.2,
} as const;

export const UTILITY_V2_SCORE_SEMANTICS = {
  mode: "OBSERVED_CONTRIBUTION" as const,
  phase: 1 as const,
  opportunityMode: "off" as const,
  scoreKind: "observed_positive_contribution",
  notes: [
    "One-sided observed-positive-contribution: floor 50; no miss penalties in Phase 1.",
    "Unmatched interrupt spam is credit-capped and cannot alone produce elite scores.",
    "Toolkit-inapplicable domains excluded from weight share and missing-data confidence.",
    "Passive/rotational support and personal mobility receive zero/negligible credit.",
    "No independent run selection — consumes frozen EvidenceManifestV2 slots only.",
  ],
} as const;

/** Writable/validated shape — numeric fields are `number` so overrides can differ from defaults. */
export type UtilityV2ModelConfig = {
  algorithmVersion: string;
  modelLabel: string;
  schemaVersion: string;
  calibrationStatus: UtilityV2CalibrationStatus;
  domainWeights: { castStops: number; support: number; strategicCc: number };
  domainContributionCap: number;
  scoreFloor: number;
  interruptCredits: {
    CONFIRMED_SUCCESS: number;
    VALID_OVERLAP: number;
    MATCHED_FAILED: number;
    UNMATCHED_ATTEMPT: number;
    NOT_OBSERVABLE: number;
  };
  unmatchedCreditShareCap: number;
  unmatchedOnlyMaxDomainScore: number;
  interruptMatchToleranceMs: number;
  ccDedupeWindowMs: number;
  supportSemanticCredit: Record<UtilityV2SupportSemantic, number>;
  supportDiminishingExponent: number;
  dispelPurgeEventCredit: number;
  castStopsCurve: ReadonlyArray<{ perHour: number; score: number }>;
  supportCurve: ReadonlyArray<{ perHour: number; score: number }>;
  strategicCcCurve: ReadonlyArray<{ perHour: number; score: number }>;
  minHostileCastsPerHourForFullCredit: number;
  activeCombatGapMs: number;
  confidence: typeof UTILITY_V2_CONFIDENCE;
  scoreSemantics: typeof UTILITY_V2_SCORE_SEMANTICS;
};

/** Immutable candidate defaults for calibration export / replay. */
export const UTILITY_V2_MODEL_CONFIG: UtilityV2ModelConfig = Object.freeze({
  algorithmVersion: UTILITY_V2_ALGORITHM_VERSION,
  modelLabel: UTILITY_V2_MODEL_LABEL,
  schemaVersion: UTILITY_V2_SCHEMA_VERSION,
  calibrationStatus: UTILITY_V2_CALIBRATION_STATUS,
  domainWeights: UTILITY_V2_DOMAIN_WEIGHTS,
  domainContributionCap: UTILITY_V2_DOMAIN_CONTRIBUTION_CAP,
  scoreFloor: UTILITY_V2_SCORE_FLOOR,
  interruptCredits: UTILITY_V2_INTERRUPT_CREDITS,
  unmatchedCreditShareCap: UTILITY_V2_UNMATCHED_CREDIT_SHARE_CAP,
  unmatchedOnlyMaxDomainScore: UTILITY_V2_UNMATCHED_ONLY_MAX_DOMAIN_SCORE,
  interruptMatchToleranceMs: UTILITY_V2_INTERRUPT_MATCH_TOLERANCE_MS,
  ccDedupeWindowMs: UTILITY_V2_CC_DEDUPE_WINDOW_MS,
  supportSemanticCredit: UTILITY_V2_SUPPORT_SEMANTIC_CREDIT,
  supportDiminishingExponent: UTILITY_V2_SUPPORT_DIMINISHING_EXPONENT,
  dispelPurgeEventCredit: UTILITY_V2_DISPEL_PURGE_EVENT_CREDIT,
  castStopsCurve: UTILITY_V2_CAST_STOPS_CURVE,
  supportCurve: UTILITY_V2_SUPPORT_CURVE,
  strategicCcCurve: UTILITY_V2_STRATEGIC_CC_CURVE,
  minHostileCastsPerHourForFullCredit: UTILITY_V2_MIN_HOSTILE_CASTS_PER_HOUR_FOR_FULL_CREDIT,
  activeCombatGapMs: UTILITY_V2_ACTIVE_COMBAT_GAP_MS,
  confidence: UTILITY_V2_CONFIDENCE,
  scoreSemantics: UTILITY_V2_SCORE_SEMANTICS,
});
