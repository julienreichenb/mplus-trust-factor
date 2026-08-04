export {
  EXPECTED_EVENT_DATASETS,
  EXPECTED_DATASETS,
  DATASETS_WITH_EVIDENCE_PAGES,
  datasetKindFromPersistedKey,
  persistedKeyForKind,
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
  FeatureConsumptionCollector,
  type FeatureConsumptionTrace,
} from "./consumption-trace.js";

export {
  parseFactDocumentIdentity,
  identitiesMatch,
  artifactIdsFromCoverage,
} from "./fact-identity.js";

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
  type AuditArtifactMetaInput,
} from "./build-evidence-audit.js";

export {
  replayScoringV2Dimensions,
  type ReplayScoringV2DimensionsInput,
  type ReplayPersistedDimension,
} from "./replay.js";
