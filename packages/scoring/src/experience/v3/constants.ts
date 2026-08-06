/**
 * Experience V3 Phase 1 — immutable model config and version stamps.
 *
 * Extends Experience V2 durable exposure with previous-season strength,
 * elite achievement history, and optional exceptional historical rank.
 * Coefficients are candidate defaults; calibration status is uncalibrated.
 * Not product-activated (SCORING_ENABLED remains default off).
 */

export const EXPERIENCE_V3_SCHEMA_VERSION = "experience-v3" as const;
export const EXPERIENCE_V3_ALGORITHM_VERSION = "experience-v3.phase1.0.1.0" as const;
export const EXPERIENCE_V3_MODEL_LABEL = "v3-phase1" as const;

export type ExperienceV3CalibrationStatus =
  | "CANDIDATE_DEFAULTS_UNCALIBRATED"
  | "CALIBRATION_IN_PROGRESS"
  | "CALIBRATED_SHADOW"
  | "CALIBRATED_ACTIVE";

export const EXPERIENCE_V3_CALIBRATION_STATUS: ExperienceV3CalibrationStatus =
  "CANDIDATE_DEFAULTS_UNCALIBRATED";

/**
 * Phase 1 component weights (sum = 1.0).
 * Unavailable optional components are excluded and remaining weights renormalized.
 */
export const EXPERIENCE_V3_COMPONENT_WEIGHTS = Object.freeze({
  /** Current durable exposure (Experience V2 successor signals). */
  currentExposure: 0.45,
  /** Previous-season Mythic+ strength. */
  previousSeasonStrength: 0.3,
  /** Elite title / achievement history. */
  eliteHistory: 0.15,
  /** Exceptional historical ranking (optional). */
  historicalRank: 0.1,
} as const);

/** Catalog / policy version stamps consumed by the calculator. */
export const EXPERIENCE_V3_ELITE_CATALOG_VERSION = "elite-achievements.v1" as const;
export const EXPERIENCE_V3_PREVIOUS_SEASON_POLICY_VERSION =
  "previous-season-normalization.v1" as const;
export const EXPERIENCE_V3_HISTORICAL_RANK_POLICY_VERSION = "historical-rank.v1" as const;

/** Writable/validated shape — numeric fields are `number` so overrides can differ from defaults. */
export type ExperienceV3ModelConfig = {
  schemaVersion: typeof EXPERIENCE_V3_SCHEMA_VERSION;
  algorithmVersion: string;
  modelLabel: string;
  calibrationStatus: ExperienceV3CalibrationStatus;
  componentWeights: {
    currentExposure: number;
    previousSeasonStrength: number;
    eliteHistory: number;
    historicalRank: number;
  };
  eliteCatalogVersion: string;
  previousSeasonPolicyVersion: string;
  historicalRankPolicyVersion: string;
  previousSeason: {
    confirmedNoActivityScore: number;
    atOrBelowK50: number;
    atK90: number;
    atK99: number;
    aboveK99Cap: number;
    partialConfidenceFactor: number;
  };
  eliteHistory: {
    singleTop01Score: number;
    additionalTitleBase: number;
    additionalDiminishing: number;
    ageDecayPerSeason: number;
    ageDecayFloor: number;
    accountVisibleCreditFactor: number;
    scoreCap: number;
  };
  historicalRank: {
    top10ClassSpecRegionScore: number;
    top01PercentScore: number;
    top1PercentScore: number;
    top5PercentScore: number;
    top10PercentScore: number;
    confirmedFloor: number;
  };
  confidenceWeights: {
    currentExposureCompleteness: number;
    previousSeasonProviderState: number;
    eliteVisibilitySemantics: number;
    historicalRankSourceQuality: number;
    seasonBinding: number;
    recency: number;
  };
  phase2AccountBoost: {
    enabled: boolean;
    characterWeight: number;
    maxBoostWeight: number;
  };
};

/**
 * Immutable Phase 1 coefficient bundle.
 * Do not mutate at runtime; clone a new versioned object for calibration.
 */
export const EXPERIENCE_V3_MODEL_CONFIG: ExperienceV3ModelConfig = Object.freeze({
  schemaVersion: EXPERIENCE_V3_SCHEMA_VERSION,
  algorithmVersion: EXPERIENCE_V3_ALGORITHM_VERSION,
  modelLabel: EXPERIENCE_V3_MODEL_LABEL,
  calibrationStatus: EXPERIENCE_V3_CALIBRATION_STATUS,
  componentWeights: EXPERIENCE_V3_COMPONENT_WEIGHTS,
  eliteCatalogVersion: EXPERIENCE_V3_ELITE_CATALOG_VERSION,
  previousSeasonPolicyVersion: EXPERIENCE_V3_PREVIOUS_SEASON_POLICY_VERSION,
  historicalRankPolicyVersion: EXPERIENCE_V3_HISTORICAL_RANK_POLICY_VERSION,

  /**
   * Previous-season strength curve (0–100) against season-normalized score.
   * Thresholds are relative to policy K50/K90/K99 — absolute cutoffs live in policy.
   */
  previousSeason: Object.freeze({
    /** Confirmed no Mythic+ activity last season — low, not zero. */
    confirmedNoActivityScore: 12,
    /** Score at/below K50 maps near this. */
    atOrBelowK50: 40,
    /** Score at K90. */
    atK90: 78,
    /** Score at/near K99. */
    atK99: 95,
    /** Cap above K99. */
    aboveK99Cap: 100,
    /** Partial evidence confidence discount. */
    partialConfidenceFactor: 0.7,
  }),

  /**
   * Elite title / achievement diminishing returns.
   * One confirmed 0.1% title is strong (~90) but cannot alone dominate the dimension.
   */
  eliteHistory: Object.freeze({
    /** Base contribution for a single top-0.1% confirmed title. */
    singleTop01Score: 90,
    /** Additional contribution per extra recent title (diminishing). */
    additionalTitleBase: 8,
    /** Decay factor applied to each successive additional title. */
    additionalDiminishing: 0.55,
    /** Mild age decay per season age (floor applied). */
    ageDecayPerSeason: 0.04,
    /** Floor after age decay. */
    ageDecayFloor: 0.75,
    /** Unconfirmed / account-visible-only titles contribute this fraction. */
    accountVisibleCreditFactor: 0.35,
    /** Cap for the elite component. */
    scoreCap: 100,
  }),

  /** Exceptional historical rank → 0–100 mapping. */
  historicalRank: Object.freeze({
    top10ClassSpecRegionScore: 98,
    top01PercentScore: 94,
    top1PercentScore: 82,
    top5PercentScore: 68,
    top10PercentScore: 55,
    /** Soft floor when a weak but confirmed historical rank exists. */
    confirmedFloor: 35,
  }),

  /** Confidence component weights (sum ≈ 1). */
  confidenceWeights: Object.freeze({
    currentExposureCompleteness: 0.28,
    previousSeasonProviderState: 0.24,
    eliteVisibilitySemantics: 0.18,
    historicalRankSourceQuality: 0.12,
    seasonBinding: 0.1,
    recency: 0.08,
  }),

  /**
   * Phase 2 verified account-linked boost — contracts only; disabled in Phase 1.
   */
  phase2AccountBoost: Object.freeze({
    enabled: false,
    characterWeight: 0.7,
    maxBoostWeight: 0.3,
  }),
});
