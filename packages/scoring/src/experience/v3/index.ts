export {
  EXPERIENCE_V3_SCHEMA_VERSION,
  EXPERIENCE_V3_ALGORITHM_VERSION,
  EXPERIENCE_V3_MODEL_LABEL,
  EXPERIENCE_V3_CALIBRATION_STATUS,
  EXPERIENCE_V3_COMPONENT_WEIGHTS,
  EXPERIENCE_V3_ELITE_CATALOG_VERSION,
  EXPERIENCE_V3_PREVIOUS_SEASON_POLICY_VERSION,
  EXPERIENCE_V3_HISTORICAL_RANK_POLICY_VERSION,
  EXPERIENCE_V3_MODEL_CONFIG,
  type ExperienceV3CalibrationStatus,
  type ExperienceV3ModelConfig,
} from "./constants.js";

export {
  ELITE_ACHIEVEMENT_CATALOG_V1,
  getEliteCatalogEntry,
  createPreviousSeasonPolicyV3,
  createHistoricalRankPolicyV3,
} from "./catalogs.js";

export { normalizePreviousSeasonScore, scorePreviousSeasonStrengthV3 } from "./previous-season.js";
export { scoreEliteHistoryV3 } from "./elite-history.js";
export { normalizeHistoricalRankScore, scoreHistoricalRankV3 } from "./historical-rank.js";
export { scoreCurrentExposureV3 } from "./exposure.js";
export { blendExperienceComponentsV3 } from "./blend.js";
export { computeExperienceConfidenceV3 } from "./confidence.js";

export {
  computeExperienceV3,
  computeExperienceV3InputFingerprint,
  toExperienceV3ShadowDimensionPayload,
} from "./compute.js";

export { exportExperienceV3Calibration } from "./calibration.js";

export type {
  ExperienceEvidenceStateV3,
  EliteAchievementVisibilityV3,
  HistoricalRankSourceV3,
  ExperienceV3AvailabilityState,
  ExperienceV3ComponentKey,
  EliteAchievementCatalogEntryV3,
  PreviousSeasonNormalizationPolicyV3,
  HistoricalRankPolicyV3,
  ExperienceV3ExposureRunInput,
  ExperienceV3CurrentExposureFact,
  ExperienceV3PreviousSeasonFact,
  ExperienceV3EliteAchievementFact,
  ExperienceV3EliteHistoryFact,
  ExperienceV3HistoricalRankFact,
  ExperienceV3AccountBoostContract,
  ExperienceV3ComponentResult,
  ExperienceV3ContributorDiagnostic,
  ExperienceV3Explanation,
  ExperienceV3ManifestIdentity,
  ExperienceV3ComputeInput,
  ExperienceV3ComputeResult,
  ExperienceV3CalibrationExport,
} from "./types.js";
