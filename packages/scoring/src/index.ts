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
export {
  computeSurvivalDimension,
  computeSurvivalConfidence,
  resolveSurvivalMetricWeights,
  scoreDeaths,
  scoreAvoidableDamage,
  scorePersonalDefensives,
  scoreSelfHealAndPotion,
  creditDefensiveUses,
  computeAvoidableDamageRate,
  explainSurvivalRun,
} from "./survival/aggregate.js";
export {
  SURVIVAL_V3_WEIGHTS,
  SURVIVAL_V3_FORMULA_VERSION,
  SURVIVAL_V3_METRIC_KEYS,
  DEATH_SOFT_CAP,
  DEFENSIVE_CREDIT_CAP_RATIO,
} from "./survival/types.js";
export type {
  SurvivalSummaryDTO,
  ComputeSurvivalResult,
  SurvivalRunInput,
  SurvivalRunExplanation,
  SurvivalContributorKey,
  SurvivalContributorScore,
  ComputeSurvivalInput,
} from "./survival/types.js";
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
