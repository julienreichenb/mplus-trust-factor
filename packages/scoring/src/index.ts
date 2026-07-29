export type {
  AuthenticityEvidence,
  AuthenticityFeatureInput,
  AuthenticityMitigationWeights,
  AuthenticityResult,
  AuthenticityFeatureWeights,
  AuthenticityTagThresholds,
  CalculateScoreEngineInput,
  ConfidenceBlendWeights,
  DimensionMetricWeights,
  DimensionScoreResult,
  ExplanationContributor,
  FinalTrustResult,
  HistoricalDecayWeights,
  MetricScoreResult,
  MetricWeightDef,
  NormalizationSpec,
  NormalizationType,
  Role,
  ScoreExplanation,
  ScoreModelConfigV1,
  ScoringContext,
  ValidationResult,
} from "./types.js";
export { DIMENSION_WEIGHT_KEYS, SKILL_DIMENSIONS } from "./types.js";

export { clamp, clamp01, approxEqual, sum, safeDivide } from "./math.js";
export { normalizeRawValue, applyHistoricalDecay, sampleSizeConfidence } from "./normalize.js";
export { validateScoreModelConfig } from "./validate.js";
export { calculateMetricScores } from "./metrics.js";
export { calculateDimensionScores } from "./dimensions.js";
export { calculateAuthenticity } from "./authenticity.js";
export {
  gradeScore,
  presentGrade,
  calculateSkillScore,
  calculateOverallConfidence,
  calculateFinalTrust,
} from "./trust.js";
export { explainScore } from "./explain.js";
export { computeInputFingerprint } from "./fingerprint.js";
export {
  createDefaultModelV1,
  createDefaultModelV2,
  createDefaultModelV3,
  createDefaultModelV4,
  createDefaultModelV5,
  createSurvivalFocusedModel,
  createUtilityFocusedModel,
} from "./model/defaults.js";
export { presentDimensionScore, presentDimensionScores } from "./present.js";
export {
  buildCharacterHistoryExperienceObservations,
  type CharacterHistoryExperienceInput,
  type CharacterHistoryRunInput,
} from "./experience/character-history.js";
export {
  buildExperienceV2Observations,
  resolveExperienceProvenance,
  computeExperienceV2,
  ablateExperienceV2,
  runCalibrationPanel,
  participationDepthNormalized,
  activityRecencyNormalized,
  EXPERIENCE_V2_CALIBRATION_PANEL,
  EXPERIENCE_V2_METRIC_WEIGHTS,
  EXPERIENCE_V2_SCHEMA_VERSION,
  EXPERIENCE_V2_ANALYSIS_VERSION,
  type ExperienceV2ObservationInput,
  type ExperienceV2RunInput,
  type ExperienceHistoryProvenance,
} from "./experience/v2/index.js";
export {
  computePerformanceDimension,
  computeCurrentSeasonPeak,
  computeCurrentSeasonConsistency,
  computeHistoricalPerformance,
  resolvePerformanceMetricWeights,
  CURRENT_SEASON_PEAK_WEIGHT,
  CURRENT_SEASON_CONSISTENCY_WEIGHT,
} from "./performance/aggregate.js";
export type {
  PerformanceSummaryDTO,
  ComputePerformanceResult,
  PerformanceDungeonAggregate,
  HistoricalSeasonAggregateInput,
  PerformanceRunRefInput,
} from "./performance/types.js";
export {
  computeSurvivalDimension,
  resolveSurvivalMetricWeights,
  medianSurvivalRunScores,
  computeSurvivalConfidence,
  SURVIVAL_OUTCOME_WEIGHT,
  SURVIVAL_DEFENSIVE_RESPONSE_WEIGHT,
  SURVIVAL_EMERGENCY_RECOVERY_WEIGHT,
} from "./survival/aggregate.js";
export type {
  SurvivalSummaryDTO,
  ComputeSurvivalResult,
  ComputeSurvivalInput,
  SurvivalDungeonAggregate,
  SurvivalExplanatoryRun,
} from "./survival/types.js";
export { calculateScore, calculateScoreEngine } from "./calculate.js";
export type { CalculateScoreInput } from "./calculate.js";
export {
  validateCoherence,
  mergeObservationsWithLastKnownGood,
  buildObservationKey,
  type CoherenceValidationInput,
  type CoherenceValidationResult,
  type CoherenceViolation,
  type CoverageState,
  type PublicationStatus,
} from "./publication/coherence.js";
export {
  selectScoringRuns,
  type ScoringRunSelection,
  type ScoringRunSelectionEntry,
  type ScoringRunCandidateInput,
  type ScoringRunSelectionReason,
} from "./selection/scoring-run-selection.js";
export {
  selectSurvivalAnalysisRuns,
  type SurvivalRunSelection,
  type SurvivalRunSelectionEntry,
  type SurvivalRunCandidateInput,
  type SurvivalRunSelectionReason,
} from "./selection/survival-run-selection.js";
export {
  resolveActiveSeasonDungeonSlugs,
  resolveActiveSeasonDungeonPool,
  isDungeonInActiveSeasonPool,
  normalizeDungeonSlug,
  readBlizzardSeasonDungeonSlugsFromMetadata,
  type ResolveActiveSeasonDungeonSlugsInput,
  type ResolvedActiveSeasonDungeonPool,
  type ActiveSeasonDungeonPoolSource,
} from "./selection/active-season-dungeons.js";
export {
  toContractScoringRunSelection,
  applyRunMetadataToSelection,
  type ScoringRunPresentationMeta,
} from "./selection/scoring-run-selection-present.js";
export {
  computeModelCoverage,
  filterPublicSkillDimensions,
  MODEL_COVERAGE_PROVISIONAL_THRESHOLD,
  type ModelCoverageSummary,
} from "./model-coverage.js";
