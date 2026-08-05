export {
  DIMENSION_COMPUTATION_LIFECYCLE_SHADOW,
  normalizeShadowDimensionRecord,
  buildUnavailableShadowDimensionRecord,
  availabilityFromComputeState,
  availabilityFromUtilityResult,
  type ScoringV2PublicDimension,
  type DimensionComputationLifecycleState,
  type DimensionAvailabilityState,
  type NormalizedShadowDimensionMetrics,
  type NormalizedShadowDimensionRecord,
  type ShadowDimensionPayloadLike,
  type NormalizeShadowDimensionRecordInput,
  type BuildUnavailableShadowDimensionRecordInput,
} from "./shadow-record.js";

export {
  isShadowPlaceholderFact,
  limitationsFromFact,
  validateFrozenManifestIdentities,
  verifyManifestContentHash,
  verifyFactSetHashesAgainstManifest,
  buildUnavailableInputFingerprint,
  algorithmVersionForDimension,
  adaptPerformanceComputeInput,
  performanceProvenanceFromManifest,
  adaptSurvivalComputeInput,
  adaptUtilityComputeInput,
  adaptExperienceComputeInput,
  type PersistedFactSetRef,
  type FrozenSlotIdentityIssue,
  type FactReadinessResult,
  type FactSetHashMismatchDetail,
  type PerformanceAdapterResult,
  type SurvivalAdapterResult,
  type UtilityAdapterResult,
  type ExperienceAdapterResult,
  type ExperienceHistoryInputs,
} from "./adapters.js";

export {
  DigestDimensionIncompleteError,
  performanceRunParseFactFromDigest,
  survivalFactDocumentFromDigest,
  utilityRunFactSetFromDigest,
  buildDigestScoreLineage,
  type DigestScoreLineageV1,
} from "./digest-adapters.js";

export {
  buildSlotFactSetBindingHash,
  type SlotFactSetBindingMember,
} from "./fact-set-binding-hash.js";

export {
  finalizeShadowDimensions,
  type ShadowDimensionFinalizerOutcomeStatus,
  type ShadowDimensionFinalizerOutcome,
  type FinalizeShadowDimensionsInput,
  type FinalizeShadowDimensionsResult,
} from "./finalize-shadow.js";
