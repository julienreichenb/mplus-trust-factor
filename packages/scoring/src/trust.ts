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
): Exclude<Grade, "U"> {
  if (score >= thresholds.S) return "S";
  if (score >= thresholds.A) return "A";
  if (score >= thresholds.B) return "B";
  if (score >= thresholds.C) return "C";
  return "D";
}

/** Present UNRATED when confidence is below the model threshold. */
export function presentGrade(
  score: number,
  confidence: number,
  model: Pick<ScoreModelConfigV1, "gradeThresholds" | "minConfidenceForGrade">,
): Grade {
  const minConfidence = model.minConfidenceForGrade ?? 0.35;
  if (confidence < minConfidence) return "U";
  return gradeScore(score, model.gradeThresholds);
}

export function calculateSkillScore(dimensions: DimensionScoreResult[]): number {
  // Renormalize over dimensions that have real evidence (confidence > 0).
  // Unavailable dimensions must not drag the skill score toward the neutral fallback.
  const available = dimensions.filter((d) => d.confidence > 0 && d.contributors.length > 0);
  const pool = available.length > 0 ? available : [];
  const weightSum = pool.reduce((s, d) => s + d.weight, 0);
  if (weightSum <= 0) return 50;
  return clamp(pool.reduce((s, d) => s + d.adjustedScore * (d.weight / weightSum), 0));
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
  const clampedConfidence = clamp01(confidence);
  return {
    skillScore: clamp(skillScore),
    authenticityScore: clamp(authenticityScore),
    observedTrust: clamp(observedTrust),
    confidence: clampedConfidence,
    overallScore,
    grade: presentGrade(overallScore, clampedConfidence, model),
  };
}
