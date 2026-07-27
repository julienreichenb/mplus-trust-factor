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
  createSurvivalFocusedModel,
  createUtilityFocusedModel,
} from "./model/defaults.js";
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
  computeExperienceDimension,
  computeExperienceConfidence,
  computeBreadthWithDiminishingReturns,
  computeCurrentPeak,
  computeHistoricalPeak,
  computeLongevityScore,
  applyAgeDecay,
  normalizeScoreAgainstTop25Cutoff,
  resolveExperienceV3MetricWeights,
  EXPERIENCE_CURRENT_PEAK_WEIGHT,
  EXPERIENCE_CURRENT_BREADTH_WEIGHT,
  EXPERIENCE_HISTORICAL_PEAK_WEIGHT,
  EXPERIENCE_LONGEVITY_WEIGHT,
  AGE_DECAY_PER_SEASON,
  AGE_DECAY_FLOOR,
  EXPERIENCE_V3_METRIC_KEYS,
} from "./experience/aggregate.js";
export type {
  ComputeExperienceInput,
  ComputeExperienceResult,
  ExperienceCharacterHistory,
  ExperienceSeasonFact,
} from "./experience/types.js";
export { calculateScore, calculateScoreEngine } from "./calculate.js";
export type { CalculateScoreInput } from "./calculate.js";

export {
  compareSelectableRuns,
  selectScoringRuns,
} from "./selection/select-scoring-runs.js";
export type {
  SelectableScoringRun,
  SelectScoringRunsInput,
} from "./selection/select-scoring-runs.js";
export {
  buildProvenance,
  toSurvivalRawFacts,
  toUtilityRawFacts,
  toPerformanceRawInputs,
  rawFactsToMetricObservations,
  summarizeFoundationSnapshot,
} from "./selection/raw-fact-persist.js";
