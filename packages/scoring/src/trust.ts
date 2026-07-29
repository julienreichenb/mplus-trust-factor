import type { Grade, ScoreModelConfig } from "@mplus/contracts";
import { clamp, clamp01 } from "./math.js";
import type {
  DimensionScoreResult,
  FinalTrustResult,
  OverallCalculationBreakdown,
  OverallDimensionContribution,
  OverallScoreFormula,
  ScoreModelConfigV1,
  ScoringContext,
} from "./types.js";

export function resolveOverallFormula(model: ScoreModelConfigV1): OverallScoreFormula {
  if (model.overallFormula === "WEIGHTED_DIMENSIONS") return "WEIGHTED_DIMENSIONS";
  if (model.overallFormula === "LEGACY_AUTHENTICITY_CONFIDENCE_BLEND") {
    return "LEGACY_AUTHENTICITY_CONFIDENCE_BLEND";
  }
  // Historical default for v1–v5 configs that omit the field.
  return "LEGACY_AUTHENTICITY_CONFIDENCE_BLEND";
}

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

/**
 * Weighted skill score from finalized public dimension scores (adjustedScore).
 * Unavailable dimensions (confidence 0 / no contributors) are excluded and weights renormalized.
 */
export function calculateSkillScore(dimensions: DimensionScoreResult[]): number {
  const available = dimensions.filter((d) => d.confidence > 0 && d.contributors.length > 0);
  const weightSum = available.reduce((s, d) => s + d.weight, 0);
  if (weightSum <= 0) return 50;
  return clamp(available.reduce((s, d) => s + d.adjustedScore * (d.weight / weightSum), 0));
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
  const formula = resolveOverallFormula(model);
  const clampedSkill = clamp(skillScore);
  const clampedAuth = clamp(authenticityScore);
  const clampedConfidence = clamp01(confidence);

  if (formula === "WEIGHTED_DIMENSIONS") {
    // Public overall === weighted public dimensions. Authenticity + global confidence stay metadata.
    const overallScore = clampedSkill;
    return {
      skillScore: clampedSkill,
      authenticityScore: clampedAuth,
      observedTrust: clampedSkill,
      confidence: clampedConfidence,
      overallScore,
      grade: presentGrade(overallScore, clampedConfidence, model),
      overallFormula: formula,
      authenticityAppliedToOverall: false,
      globalConfidenceAppliedToOverall: false,
    };
  }

  const observedTrust =
    clampedSkill *
    (model.authenticityBlend.skillWeight +
      model.authenticityBlend.authenticityWeight * (clampedAuth / 100));
  const overallScore = clamp(
    clampedConfidence * observedTrust + (1 - clampedConfidence) * model.confidenceNeutralScore,
  );
  return {
    skillScore: clampedSkill,
    authenticityScore: clampedAuth,
    observedTrust: clamp(observedTrust),
    confidence: clampedConfidence,
    overallScore,
    grade: presentGrade(overallScore, clampedConfidence, model),
    overallFormula: formula,
    authenticityAppliedToOverall: true,
    globalConfidenceAppliedToOverall: true,
  };
}

/** Deterministic overall contribution table for explanations / diagnostics. */
export function buildOverallCalculationBreakdown(input: {
  dimensions: DimensionScoreResult[];
  trust: FinalTrustResult;
}): OverallCalculationBreakdown {
  const available = input.dimensions.filter((d) => d.confidence > 0 && d.contributors.length > 0);
  const weightSum = available.reduce((s, d) => s + d.weight, 0);

  const rows: OverallDimensionContribution[] = input.dimensions.map((d) => {
    const isAvailable = d.confidence > 0 && d.contributors.length > 0;
    const effectiveWeight = isAvailable && weightSum > 0 ? d.weight / weightSum : 0;
    const score = isAvailable ? d.adjustedScore : null;
    return {
      dimension: d.dimension,
      score,
      configuredWeight: d.weight,
      effectiveWeight,
      weightedContribution: score != null ? score * effectiveWeight : 0,
      confidence: d.confidence,
      state: !isAvailable
        ? "UNAVAILABLE"
        : d.coverage < 0.5 || d.confidence < 0.35
          ? "PARTIAL"
          : "AVAILABLE",
    };
  });

  return {
    overallFormula: input.trust.overallFormula,
    dimensions: rows,
    skillScore: input.trust.skillScore,
    authenticityScore: input.trust.authenticityScore,
    authenticityAppliedToOverall: input.trust.authenticityAppliedToOverall,
    globalConfidence: input.trust.confidence,
    globalConfidenceAppliedToOverall: input.trust.globalConfidenceAppliedToOverall,
    overallScore: input.trust.overallScore,
    roundingMode: "none_internal_round_for_presentation",
  };
}
