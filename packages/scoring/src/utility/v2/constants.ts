/**
 * Utility V2 — toolkit-exploitation model config (functional Phase 3).
 *
 * Scores 0–100 exploitation of the applicable Ability Catalog toolkit.
 * Opportunity Mode remains off (no miss / tactical-correctness penalties).
 * Calibration status: candidate defaults; coefficients live in this config.
 */

import type { UtilityV2FamilyKey } from "./families.js";

export const UTILITY_V2_SCHEMA_VERSION = "utility-v2-facts";
export const UTILITY_V2_EXTRACTOR_FAMILY = "utility";
export const UTILITY_V2_EXTRACTOR_VERSION = "utility-v2.0.0";
export const UTILITY_V2_ALGORITHM_VERSION = "utility-v2-phase3-toolkit-0.1.0";
export const UTILITY_V2_MODEL_LABEL = "utility-v2-phase3-toolkit";
export type UtilityV2CalibrationStatus =
  | "CANDIDATE_DEFAULTS_UNCALIBRATED"
  | "CALIBRATION_IN_PROGRESS"
  | "CALIBRATED_SHADOW"
  | "CALIBRATED_ACTIVE";
export const UTILITY_V2_CALIBRATION_STATUS: UtilityV2CalibrationStatus =
  "CANDIDATE_DEFAULTS_UNCALIBRATED";

/**
 * Family weights among included toolkit families (renormalize when N/A / unused-optional).
 * Sum = 1.
 */
export const UTILITY_V2_FAMILY_WEIGHTS = {
  interrupt: 0.28,
  crowdControl: 0.18,
  dispelPurge: 0.16,
  groupSupport: 0.18,
  movement: 0.1,
  combatRes: 0.05,
  bloodlust: 0.05,
} as const satisfies Record<UtilityV2FamilyKey, number>;

/** @deprecated Prefer UTILITY_V2_FAMILY_WEIGHTS.interrupt */
export const UTILITY_V2_DOMAIN_WEIGHTS = {
  castStops: UTILITY_V2_FAMILY_WEIGHTS.interrupt,
  support: UTILITY_V2_FAMILY_WEIGHTS.groupSupport + UTILITY_V2_FAMILY_WEIGHTS.dispelPurge,
  strategicCc: UTILITY_V2_FAMILY_WEIGHTS.crowdControl,
} as const;

export type UtilityV2DomainKey = UtilityV2FamilyKey;

/** Clamp on a single family raw score (0–100). Not a hidden contribution floor. */
export const UTILITY_V2_DOMAIN_CONTRIBUTION_CAP = 100;

/** Inclusive floor after weighted average. Candidate default is a true 0. */
export const UTILITY_V2_SCORE_FLOOR = 0;

/**
 * Interrupt usage credit by attempt class.
 * Legitimate non-landed attempts are only slightly below a confirmed kick.
 */
export const UTILITY_V2_INTERRUPT_CREDITS = {
  CONFIRMED_SUCCESS: 1.0,
  VALID_OVERLAP: 0.9,
  MATCHED_FAILED: 0.8,
  UNMATCHED_ATTEMPT: 0.15,
  NOT_OBSERVABLE: 0,
} as const;

/**
 * Cap on unmatched attempt credit share of total interrupt credit.
 * Unmatched spam alone cannot produce an elite interrupt family score.
 */
export const UTILITY_V2_UNMATCHED_CREDIT_SHARE_CAP = 0.35;

/** Max interrupt-family raw score reachable from unmatched-only credit after curve. */
export const UTILITY_V2_UNMATCHED_ONLY_MAX_DOMAIN_SCORE = 35;

/** Match window: interrupt cast ↔ confirmed interrupt / hostile window (ms). */
export const UTILITY_V2_INTERRUPT_MATCH_TOLERANCE_MS = 1_500;

/** CC / family-action dedupe: same ability+target within this window counts once. */
export const UTILITY_V2_CC_DEDUPE_WINDOW_MS = 3_000;

export const UTILITY_V2_SUPPORT_SEMANTIC_CREDIT = {
  REACTIVE_SUPPORT: 1,
  STRATEGIC_SUPPORT: 0.9,
  EMERGENCY_SUPPORT: 1,
  ROUTINE_ROTATIONAL_SUPPORT: 0.05,
  PASSIVE_SUPPORT: 0,
  PERSONAL_MOBILITY: 1,
  UNVERIFIED_EXTERNAL: 0,
} as const;

export type UtilityV2SupportSemantic = keyof typeof UTILITY_V2_SUPPORT_SEMANTIC_CREDIT;

export const UTILITY_V2_DISPEL_PURGE_EVENT_CREDIT = 1;

/** Group-support credit diminishing: effective = raw^exponent. */
export const UTILITY_V2_SUPPORT_DIMINISHING_EXPONENT = 0.75;

export type UtilityV2CurveKnot = { perHour: number; score: number };

/**
 * Category-specific saturation vs active combat hours.
 * 0 use → 0; ordinary partial → mid-scale; strong → 80+; exceptional → 100.
 * Anchors are not theoretical max-casts-by-cooldown.
 */
export const UTILITY_V2_FAMILY_CURVES: Record<
  UtilityV2FamilyKey,
  ReadonlyArray<UtilityV2CurveKnot>
> = {
  interrupt: [
    { perHour: 0, score: 0 },
    { perHour: 2, score: 20 },
    { perHour: 6, score: 45 },
    { perHour: 12, score: 70 },
    { perHour: 20, score: 85 },
    { perHour: 30, score: 95 },
    { perHour: 40, score: 100 },
  ],
  crowdControl: [
    { perHour: 0, score: 0 },
    { perHour: 1, score: 25 },
    { perHour: 3, score: 50 },
    { perHour: 6, score: 70 },
    { perHour: 10, score: 85 },
    { perHour: 16, score: 100 },
  ],
  dispelPurge: [
    { perHour: 0, score: 0 },
    { perHour: 2, score: 30 },
    { perHour: 6, score: 55 },
    { perHour: 12, score: 80 },
    { perHour: 20, score: 92 },
    { perHour: 28, score: 100 },
  ],
  groupSupport: [
    { perHour: 0, score: 0 },
    { perHour: 2, score: 30 },
    { perHour: 6, score: 55 },
    { perHour: 12, score: 80 },
    { perHour: 20, score: 92 },
    { perHour: 28, score: 100 },
  ],
  movement: [
    { perHour: 0, score: 0 },
    { perHour: 4, score: 30 },
    { perHour: 10, score: 55 },
    { perHour: 18, score: 80 },
    { perHour: 28, score: 92 },
    { perHour: 40, score: 100 },
  ],
  combatRes: [
    { perHour: 0, score: 0 },
    { perHour: 0.2, score: 55 },
    { perHour: 0.5, score: 80 },
    { perHour: 1, score: 100 },
  ],
  bloodlust: [
    { perHour: 0, score: 0 },
    { perHour: 0.3, score: 60 },
    { perHour: 0.8, score: 85 },
    { perHour: 1.5, score: 100 },
  ],
};

/** @deprecated Prefer UTILITY_V2_FAMILY_CURVES.interrupt */
export const UTILITY_V2_CAST_STOPS_CURVE = UTILITY_V2_FAMILY_CURVES.interrupt;
/** @deprecated Prefer UTILITY_V2_FAMILY_CURVES.groupSupport */
export const UTILITY_V2_SUPPORT_CURVE = UTILITY_V2_FAMILY_CURVES.groupSupport;
/** @deprecated Prefer UTILITY_V2_FAMILY_CURVES.crowdControl */
export const UTILITY_V2_STRATEGIC_CC_CURVE = UTILITY_V2_FAMILY_CURVES.crowdControl;

/** Hostile begincasts/hour below this is a confidence signal, not a score floor. */
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
  phase: 3 as const,
  opportunityMode: "off" as const,
  scoreKind: "toolkit_exploitation",
  notes: [
    "Functional Utility Phase 3: 0–100 toolkit exploitation by Ability Catalog family.",
    "No hidden 50 floor. Unused applicable families contribute 0; inapplicable families are excluded.",
    "Optional group expectations (battle rez / bloodlust) do not penalize when unused.",
    "Uncertain talent applicability is excluded from score — never a fabricated unused-toolkit zero.",
    "CONFIRMED_SUCCESS ≈ VALID_OVERLAP ≈ MATCHED_FAILED; unmatched spam is credit-capped.",
    "Intensity is per active combat hour with family saturation curves — not fight_duration/cooldown.",
    "Opportunity Mode remains off: no tactical-correctness or missed-mechanic engine.",
    "Missing datasets are partial/unavailable — not treated as player underperformance.",
    "No independent run selection — consumes frozen EvidenceManifestV2 slots only.",
  ],
} as const;

/** Writable/validated confidence shape — numeric fields are `number` for overrides. */
export type UtilityV2ConfidenceConfig = {
  expectedDungeons: number;
  runSaturation: number;
  combatHourSaturation: number;
  attributableEventSaturation: number;
  tinyRunThreshold: number;
  maxWhenTinySample: number;
  maxWhenPartialDungeons: number;
  maxWhenZeroAttributable: number;
  maxWhenNoHostileCasts: number;
  maxWhenMechanicCatalogBelow: ReadonlyArray<{ below: number; maxConfidence: number }>;
  weights: {
    dungeonCoverage: number;
    runCoverage: number;
    combatDuration: number;
    attributableEvents: number;
    mechanicCatalogCoverageObserved: number;
    sourceCompleteness: number;
  };
  minReliability: number;
};

export type UtilityV2ScoreSemantics = {
  mode: "OBSERVED_CONTRIBUTION";
  phase: 1 | 2 | 3;
  opportunityMode: "off";
  scoreKind: string;
  notes: readonly string[];
};

export type UtilityV2FamilyWeights = Record<UtilityV2FamilyKey, number>;
export type UtilityV2FamilyCurves = Record<
  UtilityV2FamilyKey,
  ReadonlyArray<UtilityV2CurveKnot>
>;

/** Writable/validated shape — numeric fields are `number` so overrides can differ from defaults. */
export type UtilityV2ModelConfig = {
  algorithmVersion: string;
  modelLabel: string;
  schemaVersion: string;
  calibrationStatus: UtilityV2CalibrationStatus;
  familyWeights: UtilityV2FamilyWeights;
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
  familyCurves: UtilityV2FamilyCurves;
  minHostileCastsPerHourForFullCredit: number;
  activeCombatGapMs: number;
  confidence: UtilityV2ConfidenceConfig;
  scoreSemantics: UtilityV2ScoreSemantics;
  /** Legacy aliases kept for explainability / replay payloads. */
  domainWeights: UtilityV2FamilyWeights;
  castStopsCurve: ReadonlyArray<UtilityV2CurveKnot>;
  supportCurve: ReadonlyArray<UtilityV2CurveKnot>;
  strategicCcCurve: ReadonlyArray<UtilityV2CurveKnot>;
};

/** Immutable candidate defaults for calibration export / replay. */
export const UTILITY_V2_MODEL_CONFIG: UtilityV2ModelConfig = Object.freeze({
  algorithmVersion: UTILITY_V2_ALGORITHM_VERSION,
  modelLabel: UTILITY_V2_MODEL_LABEL,
  schemaVersion: UTILITY_V2_SCHEMA_VERSION,
  calibrationStatus: UTILITY_V2_CALIBRATION_STATUS,
  familyWeights: UTILITY_V2_FAMILY_WEIGHTS,
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
  familyCurves: UTILITY_V2_FAMILY_CURVES,
  minHostileCastsPerHourForFullCredit: UTILITY_V2_MIN_HOSTILE_CASTS_PER_HOUR_FOR_FULL_CREDIT,
  activeCombatGapMs: UTILITY_V2_ACTIVE_COMBAT_GAP_MS,
  confidence: UTILITY_V2_CONFIDENCE,
  scoreSemantics: UTILITY_V2_SCORE_SEMANTICS,
  domainWeights: UTILITY_V2_FAMILY_WEIGHTS,
  castStopsCurve: UTILITY_V2_FAMILY_CURVES.interrupt,
  supportCurve: UTILITY_V2_FAMILY_CURVES.groupSupport,
  strategicCcCurve: UTILITY_V2_FAMILY_CURVES.crowdControl,
});
