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
export {
  computeKeyDifficultyPercentile,
  interpolateKeyDifficultyPercentile,
  BOUNDED_KEY_DIFFICULTY_ANCHORS,
  BOUNDED_KEY_DIFFICULTY_SOFT_CAP,
} from "./performance/key-difficulty.js";
export type {
  KeyDifficultyAnchor,
  KeyDifficultyResult,
  KeyDifficultyNormalizationSource,
  SeasonKeyDifficultyContext,
} from "./performance/key-difficulty.js";
export { resolveSelectedRunParsePercentile } from "./performance/parse-binding.js";
export type {
  RankingParseCandidate,
  SelectedRunParseBinding,
  ParseBindingSource,
} from "./performance/parse-binding.js";
export {
  computePerformanceDimensionV3,
  computeRunPerformance,
  computePerformanceV3Confidence,
  resolvePerformanceV3MetricWeights,
  PERFORMANCE_V3_EXECUTION_WEIGHT,
  PERFORMANCE_V3_KEY_DIFFICULTY_WEIGHT,
  PERFORMANCE_V3_FORMULA_VERSION,
} from "./performance/v3.js";
export type {
  PerformanceV3DungeonInput,
  PerformanceV3DungeonResult,
  ComputePerformanceV3Input,
  ComputePerformanceV3Result,
} from "./performance/v3.js";
export type {
  PerformanceSummaryDTO,
  ComputePerformanceResult,
  PerformanceDungeonAggregate,
  HistoricalSeasonAggregateInput,
  PerformanceRunRefInput,
} from "./performance/types.js";
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
