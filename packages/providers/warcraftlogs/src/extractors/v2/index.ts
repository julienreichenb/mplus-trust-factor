export {
  PERFORMANCE_V2_EXTRACTOR_FAMILY,
  PERFORMANCE_V2_EXTRACTOR_VERSION,
  PERFORMANCE_V2_FACT_SCHEMA_VERSION,
  SURVIVAL_V2_FACT_EXTRACTOR_VERSION,
  SURVIVAL_V2_MAX_DANGER_WINDOWS,
  FACT_V2_MAX_LIMITATIONS,
} from "./constants.js";

export {
  canonicalizeForHash,
  hashFactDocumentContent,
  buildTypedFactSetFingerprint,
} from "./content-hash.js";

export type {
  ScoringExtractableDimension,
  DimensionFactExtractionStatus,
  FactExtractionCategory,
  DimensionFactExtractionOutcome,
  FrozenSlotBindingV2,
  RankingParseEvidenceV2,
  PerformanceFactDocumentV2,
  PerformanceFactExtractionOutcome,
  PerformanceProfileExtractionOutcome,
  SurvivalFactExtractionOutcome,
  UtilityFactExtractionOutcome,
} from "./types.js";

export {
  extractPerformanceRunParseFactV2,
  extractPerformanceProfileAggregateFactV2,
  toPerformanceRunParseFactV2,
  isPerformanceFactDocumentV2,
} from "./performance.js";

export {
  mapSurvivalRunToFactDocumentV2,
  extractSurvivalFactDocumentV2FromSharedEvidence,
} from "./survival.js";

export {
  mapUtilityNormalizedRunToFactSet,
  extractUtilityV2RunFactSetFromSharedEvidence,
} from "./utility.js";
