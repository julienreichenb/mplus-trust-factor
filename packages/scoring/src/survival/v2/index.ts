export {
  SURVIVAL_V2_SCHEMA_VERSION,
  SURVIVAL_V2_CALIBRATION_SCHEMA_VERSION,
  SURVIVAL_V2_EXTRACTOR_FAMILY,
  SURVIVAL_V2_ALGORITHM_VERSION,
  SURVIVAL_V2_MODEL_LABEL,
  SURVIVAL_V2_CALIBRATION_STATUS,
  SURVIVAL_V2_OUTCOME_BY_DEATHS,
  SURVIVAL_V2_WEIGHTS_WITH_RELATIVE,
  SURVIVAL_V2_WEIGHTS_SHADOW_OR_OFF,
  SURVIVAL_V2_DANGER,
  SURVIVAL_V2_DEFENSIVE_RATE,
  SURVIVAL_V2_METRIC_KEYS,
  SURVIVAL_V2_MODEL_CONFIG,
  type SurvivalV2RelativeDamageMode,
  type SurvivalV2CalibrationStatus,
  type SurvivalV2ModelConfig,
} from "./constants.js";

export type {
  SurvivalFactDocumentV2,
  SurvivalV2AvailabilityState,
  SurvivalV2CalibrationExport,
  SurvivalV2ComputeInput,
  SurvivalV2ComputeResult,
  SurvivalV2ComponentResult,
  SurvivalV2ContributorDiagnostic,
  SurvivalV2DangerWindowFact,
  SurvivalV2DungeonAggregate,
  SurvivalV2HealthEvidenceMode,
  SurvivalV2RelativeDamageShadow,
  SurvivalV2RunScore,
  SurvivalV2ShadowDimensionPayload,
  SurvivalV2ToolkitAvailabilityState,
  SurvivalV2ToolkitEntry,
} from "./types.js";

export {
  parseSurvivalFactDocumentV2,
  survivalFactSlotKey,
} from "./facts.js";

export { scoreSurvivalV2Outcome } from "./outcome.js";
export {
  scoreSurvivalV2Defensive,
  saturatingDefensiveRateScore,
} from "./defensive.js";
export {
  mergePressureClusters,
  scoreSurvivalV2EmergencyRecovery,
} from "./recovery.js";
export {
  scoreSurvivalV2RelativeDamageShadow,
  isSurvivalV2RelativeDamageWeightActive,
  relativeDamageBlendScore,
} from "./relative-damage.js";
export { resolveSurvivalV2Weights } from "./weights.js";
export { scoreSurvivalV2Run } from "./run-score.js";
export {
  medianOf,
  meanOf,
  aggregateSurvivalV2Dungeon,
  aggregateSurvivalV2Season,
  computeSurvivalV2Confidence,
} from "./aggregate.js";
export {
  computeSurvivalV2,
  buildSurvivalV2InputFingerprint,
  toSurvivalV2ShadowDimensionPayload,
  type SurvivalV2ComputeOptions,
} from "./compute.js";
export {
  parseSurvivalV2ModelConfig,
  resolveSurvivalV2ModelConfig,
  fingerprintSurvivalV2ModelConfig,
  SURVIVAL_V2_DEFAULT_CONFIG_FINGERPRINT,
} from "./model-config.js";
export { exportSurvivalV2Calibration } from "./calibration.js";
