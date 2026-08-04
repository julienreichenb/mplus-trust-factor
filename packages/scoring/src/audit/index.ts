export {
  EXPECTED_EVENT_DATASETS,
  datasetKindFromPersistedKey,
  persistedKeyForDatasetKind,
  normalizePersistedDatasetKey,
  type PersistedDatasetKey,
  type ExpectedEventDatasetSpec,
} from "./dataset-catalog.js";

export {
  SURVIVAL_FEATURE_REGISTRY,
  UTILITY_FEATURE_REGISTRY,
  PERFORMANCE_FEATURE_REGISTRY,
  getFeatureRegistryV2,
  featuresForDimension,
} from "./feature-registry.js";

export {
  buildSurvivalFeatureUsage,
  buildUtilityFeatureUsage,
  buildPerformanceFeatureUsage,
  featureUsageFromMetrics,
  type FeatureUsageBuildResult,
} from "./feature-usage.js";

export {
  buildScoringV2EvidenceAudit,
  fingerprintExplanationMetrics,
  type BuildScoringV2EvidenceAuditInput,
  type AuditDatasetInput,
  type AuditDatasetPageInput,
  type AuditFactSetInput,
  type AuditDimensionInput,
  type AuditMasterDataInput,
  type AuditManifestSlotRow,
} from "./build-evidence-audit.js";

export {
  replayScoringV2Dimensions,
  type ReplayScoringV2DimensionsInput,
  type ReplayPersistedDimension,
} from "./replay.js";
