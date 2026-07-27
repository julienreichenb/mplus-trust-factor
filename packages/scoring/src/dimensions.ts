import type { MetricObservationDTO, ScoreDimension } from "@mplus/contracts";
import { clamp, clamp01, safeDivide } from "./math.js";
import { calculateMetricScores, coverageRatio } from "./metrics.js";
import type {
  DimensionScoreResult,
  MetricScoreResult,
  ScoreModelConfigV1,
  ScoringContext,
} from "./types.js";
import { DIMENSION_WEIGHT_KEYS, SKILL_DIMENSIONS } from "./types.js";

export function calculateDimensionScores(
  observations: MetricObservationDTO[],
  model: ScoreModelConfigV1,
  context: ScoringContext,
  metricScores?: MetricScoreResult[],
): DimensionScoreResult[] {
  const metrics = metricScores ?? calculateMetricScores(observations, model, context);
  return SKILL_DIMENSIONS.map((dimension) => scoreOneDimension(dimension, metrics, model));
}

function scoreOneDimension(
  dimension: ScoreDimension,
  metrics: MetricScoreResult[],
  model: ScoreModelConfigV1,
): DimensionScoreResult {
  const configured = metrics.filter((m) => m.dimension === dimension);
  const available = configured.filter((m) => m.available && m.normalizedValue != null);
  const missing = configured.filter((m) => !m.available);
  const coverage = coverageRatio(metrics, dimension);
  const weightKey = DIMENSION_WEIGHT_KEYS[dimension as Exclude<ScoreDimension, "AUTHENTICITY">];
  const weight = model.weights[weightKey];

  let rawScore = model.confidenceNeutralScore;
  if (available.length > 0) {
    const availWeight = available.reduce((s, m) => s + m.weight, 0);
    rawScore = available.reduce(
      (s, m) => s + m.normalizedValue! * safeDivide(m.weight, availWeight, 0),
      0,
    );
  }

  const avgProviderConf =
    available.length === 0
      ? 0
      : available.reduce((s, m) => s + m.confidence, 0) / available.length;
  const dimensionConfidence = clamp01(0.55 * coverage + 0.45 * avgProviderConf);

  let adjusted =
    dimensionConfidence * rawScore + (1 - dimensionConfidence) * model.confidenceNeutralScore;

  if (coverage < model.minCoverageForExtreme) {
    adjusted = clamp(adjusted, model.extremeCapLow, model.extremeCapHigh);
  }

  return {
    dimension,
    rawScore: clamp(rawScore),
    adjustedScore: clamp(adjusted),
    confidence: dimensionConfidence,
    coverage,
    weight,
    contributors: available,
    missing,
  };
}
