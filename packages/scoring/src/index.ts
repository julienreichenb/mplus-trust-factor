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
  computeUtilityDimension,
  computeInterruptScore,
  computeKickActivityScore,
  computeKickSuccessScore,
  computeCrowdControlScore,
  computeGroupSupportScore,
  computeDispelScore,
  computeUtilityConfidence,
  resolveUtilityContributorWeights,
  resolveUtilityMetricWeights,
  explainUtilityRun,
  UTILITY_INTERRUPT_WEIGHT,
  UTILITY_CROWD_CONTROL_WEIGHT,
  UTILITY_GROUP_SUPPORT_WEIGHT,
  UTILITY_DISPELS_WEIGHT,
  KICK_ACTIVITY_WEIGHT,
  KICK_SUCCESS_WEIGHT,
  UTILITY_V3_FORMULA_VERSION,
  UTILITY_V3_METRIC_KEYS,
} from "./utility/aggregate.js";
export { utilityDimensionToMetricObservations } from "./utility/observations.js";
export type {
  UtilitySummaryDTO,
  ComputeUtilityResult,
  ComputeUtilityInput,
  UtilityRunFactsInput,
  UtilityRunScore,
  UtilityContributorScore,
} from "./utility/types.js";
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
