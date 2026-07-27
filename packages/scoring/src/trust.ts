import type { Grade, ScoreModelConfig } from "@mplus/contracts";
import { clamp, clamp01 } from "./math.js";
import type {
  DimensionScoreResult,
  FinalTrustResult,
  ScoreModelConfigV1,
  ScoringContext,
} from "./types.js";

export function gradeScore(
  score: number,
  thresholds: ScoreModelConfig["gradeThresholds"],
): Grade {
  if (score >= thresholds.S) return "S";
  if (score >= thresholds.A) return "A";
  if (score >= thresholds.B) return "B";
  if (score >= thresholds.C) return "C";
  return "D";
}

export function calculateSkillScore(dimensions: DimensionScoreResult[]): number {
  const weightSum = dimensions.reduce((s, d) => s + d.weight, 0);
  if (weightSum <= 0) return 50;
  return clamp(
    dimensions.reduce((s, d) => s + d.adjustedScore * (d.weight / weightSum), 0),
  );
}

export function calculateOverallConfidence(
  dimensions: DimensionScoreResult[],
  model: ScoreModelConfigV1,
  context: ScoringContext,
): number {
  const dimConf =
    dimensions.length === 0
      ? 0
      : dimensions.reduce((s, d) => s + d.confidence * d.weight, 0) /
        dimensions.reduce((s, d) => s + d.weight, 0);
  const sourceCoverage =
    dimensions.length === 0
      ? 0
      : dimensions.reduce((s, d) => s + d.coverage * d.weight, 0) /
        dimensions.reduce((s, d) => s + d.weight, 0);
  const freshness = clamp01(context.freshness ?? 0.7);
  const selectedRunCoverage = clamp01(context.selectedRunCoverage ?? sourceCoverage);
  const b = model.confidenceBlend;
  return clamp01(
    b.dimensionConfidence * dimConf +
      b.sourceCoverage * sourceCoverage +
      b.freshness * freshness +
      b.selectedRunCoverage * selectedRunCoverage,
  );
}

export function calculateFinalTrust(input: {
  skillScore: number;
  authenticityScore: number;
  confidence: number;
  model: ScoreModelConfigV1;
}): FinalTrustResult {
  const { skillScore, authenticityScore, confidence, model } = input;
  const observedTrust =
    skillScore *
    (model.authenticityBlend.skillWeight +
      model.authenticityBlend.authenticityWeight * (authenticityScore / 100));
  const overallScore = clamp(
    confidence * observedTrust + (1 - confidence) * model.confidenceNeutralScore,
  );
  return {
    skillScore: clamp(skillScore),
    authenticityScore: clamp(authenticityScore),
    observedTrust: clamp(observedTrust),
    confidence: clamp01(confidence),
    overallScore,
    grade: gradeScore(overallScore, model.gradeThresholds),
  };
}
