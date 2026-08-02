export {
  UTILITY_V2_SCHEMA_VERSION,
  UTILITY_V2_EXTRACTOR_FAMILY,
  UTILITY_V2_EXTRACTOR_VERSION,
  UTILITY_V2_ALGORITHM_VERSION,
  UTILITY_V2_MODEL_LABEL,
  UTILITY_V2_CALIBRATION_STATUS,
  UTILITY_V2_DOMAIN_WEIGHTS,
  UTILITY_V2_DOMAIN_CONTRIBUTION_CAP,
  UTILITY_V2_SCORE_FLOOR,
  UTILITY_V2_INTERRUPT_CREDITS,
  UTILITY_V2_UNMATCHED_CREDIT_SHARE_CAP,
  UTILITY_V2_UNMATCHED_ONLY_MAX_DOMAIN_SCORE,
  UTILITY_V2_SUPPORT_SEMANTIC_CREDIT,
  UTILITY_V2_SCORE_SEMANTICS,
  UTILITY_V2_MODEL_CONFIG,
  type UtilityV2DomainKey,
  type UtilityV2SupportSemantic,
  type UtilityV2CalibrationStatus,
  type UtilityV2ModelConfig,
} from "./constants.js";

export {
  classifyInterruptAttempts,
  sumInterruptCredits,
  type ClassifyInterruptAttemptsInput,
} from "./classify-interrupts.js";

export {
  estimateActiveCombatMs,
  activeCombatHours,
  type ActiveCombatEstimate,
} from "./active-combat.js";

export {
  bindUtilityV2FactsToManifest,
  selectedManifestSlots,
} from "./bind.js";

export {
  computeUtilityV2InputFingerprint,
  stableStringify,
} from "./fingerprint.js";

export {
  computeUtilityV2,
  applyUnmatchedSpamCap,
  dedupeStrategicCc,
  scoreSupportCredit,
  emptyUtilityV2FactSet,
} from "./compute.js";

export {
  parseUtilityV2ModelConfig,
  resolveUtilityV2ModelConfig,
  fingerprintUtilityV2ModelConfig,
  UTILITY_V2_DEFAULT_CONFIG_FINGERPRINT,
} from "./model-config.js";

export { toUtilityV2ShadowDimensionPayload } from "./shadow.js";

export { exportUtilityV2Calibration } from "./calibration.js";

export { buildUtilityV2RunFactSet, type BuildUtilityV2FactSetInput } from "./build-facts.js";

export type {
  InterruptAttemptClass,
  UtilityV2ActorKind,
  UtilityV2AvailabilityState,
  UtilityV2FrozenSlotIdentity,
  UtilityV2ManifestSlotRef,
  UtilityV2FrozenManifestRef,
  UtilityV2InterruptAttemptSeed,
  UtilityV2ConfirmedInterruptEvent,
  UtilityV2HostileCastWindow,
  ClassifiedInterruptAttempt,
  UtilityV2CcAction,
  UtilityV2SupportAction,
  UtilityV2ToolkitApplicability,
  UtilityV2RunFactSet,
  UtilityV2DomainBreakdown,
  UtilityV2InterruptCounts,
  UtilityV2ComputeInput,
  UtilityV2ComputeResult,
  UtilityV2Explanation,
  UtilityV2BindingResult,
  UtilityV2ShadowDimensionPayload,
  UtilityV2ShadowDimensionRecord,
  UtilityV2CalibrationExport,
} from "./types.js";
