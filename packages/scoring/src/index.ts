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
  calculateSkillScore,
  calculateOverallConfidence,
  calculateFinalTrust,
} from "./trust.js";
export { explainScore } from "./explain.js";
export { computeInputFingerprint } from "./fingerprint.js";
export {
  createDefaultModelV1,
  createSurvivalFocusedModel,
  createUtilityFocusedModel,
} from "./model/defaults.js";
export { calculateScore, calculateScoreEngine } from "./calculate.js";
export type { CalculateScoreInput } from "./calculate.js";
