/**
 * Overall composite confidence semantics (intentionally weakest-link).
 *
 * evidenceConfidence = min(available dimension confidences that are finite)
 * confidence = evidenceConfidence × availabilityCoverage
 * availabilityCoverage = sum(available base weights) / sum(all base weights)
 *
 * Product notes (do not silently retune):
 * - min() is the documented weakest-link rule (see doc/scoring/SCORING_DIMENSIONS.md).
 * - Dimension weights influence availabilityCoverage and composite score, but not
 *   which confidence is selected beyond inclusion in the min set.
 * - Experience now contributes an explicit confidence when available (resolved
 *   historical evidence → 1). Unavailable E only reduces coverage.
 * - availabilityCoverage can double-penalize missing Experience relative to a
 *   design where missing dims are omitted from both score and confidence.
 */
import { clamp, clamp01 } from "../math.js";
import {
  PARTIAL_COMPOSITE_CONFIDENCE_FORMULA_VERSION,
  uniqueCauses,
} from "../confidence/dimension-confidence.js";
import { createDefaultModelV1 } from "../model/defaults.js";
import { gradeScore } from "../trust.js";
import type { ScoreModelConfigV1 } from "../types.js";
import type { Grade, ScoreModelConfig } from "@mplus/contracts";

export type PublicSkillDimensionKey =
  | "performance"
  | "survival"
  | "utility"
  | "experience";

export interface PartialCompositeDimensionInput {
  key: PublicSkillDimensionKey;
  /** Observed score 0–100 when available. */
  score: number | null;
  /** True when this dimension has a usable score for the composite. */
  available: boolean;
  /** Model base weight (relative or already fractional — only ratios matter). */
  baseWeight: number;
  /** Per-dimension evidence confidence 0–1 when available. */
  confidence?: number | null;
  /** Machine-readable causes from the dimension confidence breakdown. */
  confidenceCauses?: readonly string[] | null;
}

export interface PartialCompositeResult {
  /** Null when zero dimensions available. */
  composite: number | null;
  /** Effective weights among available dims (sum to 1), empty when none. */
  effectiveWeights: Partial<Record<PublicSkillDimensionKey, number>>;
  /** sum(available base) / sum(all base); 0 when no model weight mass. */
  availabilityCoverage: number;
  availableCount: number;
  /** Evidence confidence × availabilityCoverage. */
  confidence: number;
  /** Letter grade or U when composite null / confidence below floor. */
  grade: Grade;
  explanation: {
    unavailableKeys: PublicSkillDimensionKey[];
    renormalized: boolean;
    availabilityCoverage: number;
    evidenceConfidence: number;
    weakestDimensionKey: PublicSkillDimensionKey | null;
    formulaVersion: typeof PARTIAL_COMPOSITE_CONFIDENCE_FORMULA_VERSION;
    causes: string[];
  };
}

const DEFAULT_BASE_WEIGHTS: Record<PublicSkillDimensionKey, number> = {
  performance: 0.35,
  survival: 0.3,
  utility: 0.25,
  experience: 0.1,
};

/** Canonical grade presentation fields from default model config (v1 base). */
const CANONICAL_GRADE_MODEL: Pick<
  ScoreModelConfigV1,
  "gradeThresholds" | "minConfidenceForGrade"
> = (() => {
  const defaults = createDefaultModelV1();
  return {
    gradeThresholds: defaults.gradeThresholds,
    minConfidenceForGrade: defaults.minConfidenceForGrade,
  };
})();

/**
 * Resolve grade thresholds + minConfidenceForGrade for presentGrade().
 * Explicit model values win; omitted minConfidenceForGrade uses the canonical default.
 */
export function resolvePartialCompositeGradeModel(
  model?: Pick<ScoreModelConfig, "gradeThresholds"> & {
    minConfidenceForGrade?: number;
  },
): Pick<ScoreModelConfigV1, "gradeThresholds" | "minConfidenceForGrade"> {
  return {
    gradeThresholds: model?.gradeThresholds ?? CANONICAL_GRADE_MODEL.gradeThresholds,
    minConfidenceForGrade:
      model?.minConfidenceForGrade ?? CANONICAL_GRADE_MODEL.minConfidenceForGrade,
  };
}

export function defaultSkillDimensionWeights(
  modelWeights?: {
    performance?: number;
    survival?: number;
    utility?: number;
    experienceConsistency?: number;
  } | null,
): Record<PublicSkillDimensionKey, number> {
  if (!modelWeights) return { ...DEFAULT_BASE_WEIGHTS };
  return {
    performance: modelWeights.performance ?? DEFAULT_BASE_WEIGHTS.performance,
    survival: modelWeights.survival ?? DEFAULT_BASE_WEIGHTS.survival,
    utility: modelWeights.utility ?? DEFAULT_BASE_WEIGHTS.utility,
    experience:
      modelWeights.experienceConsistency ?? DEFAULT_BASE_WEIGHTS.experience,
  };
}

/**
 * Compute partial composite + confidence + grade from available dimensions.
 */
export function computePartialComposite(
  dimensions: readonly PartialCompositeDimensionInput[],
  model: Pick<ScoreModelConfig, "gradeThresholds"> & {
    minConfidenceForGrade?: number;
  } = CANONICAL_GRADE_MODEL,
): PartialCompositeResult {
  const gradeModel = resolvePartialCompositeGradeModel(model);
  const totalBase = dimensions.reduce(
    (sum, d) => sum + Math.max(0, d.baseWeight),
    0,
  );
  const available = dimensions.filter(
    (d) =>
      d.available &&
      d.score != null &&
      Number.isFinite(d.score) &&
      d.baseWeight > 0,
  );
  const unavailableKeys = dimensions
    .filter((d) => !available.some((a) => a.key === d.key))
    .map((d) => d.key);

  const availableBase = available.reduce((sum, d) => sum + d.baseWeight, 0);
  const availabilityCoverage =
    totalBase > 0 ? clamp01(availableBase / totalBase) : 0;

  if (available.length === 0 || availableBase <= 0) {
    const causes = uniqueCauses([
      "no_available_dimensions",
      ...unavailableKeys.map((k) => `dimension_unavailable:${k}`),
    ]);
    return {
      composite: null,
      effectiveWeights: {},
      availabilityCoverage,
      availableCount: 0,
      confidence: 0,
      grade: "U",
      explanation: {
        unavailableKeys,
        renormalized: false,
        availabilityCoverage,
        evidenceConfidence: 0,
        weakestDimensionKey: null,
        formulaVersion: PARTIAL_COMPOSITE_CONFIDENCE_FORMULA_VERSION,
        causes,
      },
    };
  }

  const effectiveWeights: Partial<Record<PublicSkillDimensionKey, number>> = {};
  let composite = 0;
  for (const d of available) {
    const w = d.baseWeight / availableBase;
    effectiveWeights[d.key] = w;
    composite += (d.score as number) * w;
  }
  composite = clamp(composite, 0, 100);

  const withConfidence = available.filter(
    (d): d is PartialCompositeDimensionInput & { confidence: number } =>
      typeof d.confidence === "number" && Number.isFinite(d.confidence),
  );
  let evidenceConfidence = 0;
  let weakestDimensionKey: PublicSkillDimensionKey | null = null;
  if (withConfidence.length > 0) {
    evidenceConfidence = Math.min(...withConfidence.map((d) => d.confidence));
    const weakest = withConfidence.find((d) => d.confidence === evidenceConfidence);
    weakestDimensionKey = weakest?.key ?? null;
  }
  const confidence = clamp01(evidenceConfidence * availabilityCoverage);

  const causes = uniqueCauses([
    ...(evidenceConfidence < 1 && weakestDimensionKey
      ? [`weakest_link:${weakestDimensionKey}`]
      : evidenceConfidence <= 0 && withConfidence.length === 0
        ? ["evidence_confidence_missing"]
        : []),
    ...(availabilityCoverage < 1
      ? [
          "availability_coverage_incomplete",
          ...unavailableKeys.map((k) => `dimension_unavailable:${k}`),
        ]
      : []),
    ...(evidenceConfidence < 1 && weakestDimensionKey
      ? (available.find((d) => d.key === weakestDimensionKey)?.confidenceCauses ??
        [])
      : []),
  ]);

  // Product rule: when a composite can be calculated from available dimensions,
  // letter grade comes from model thresholds only. Grade U is reserved for
  // "no calculable composite" — not for reduced confidence / missing Experience.
  // Confidence remains reduced (availabilityCoverage) for UI flagging.
  const grade =
    composite == null ? "U" : gradeScore(composite, gradeModel.gradeThresholds);

  return {
    composite,
    effectiveWeights,
    availabilityCoverage,
    availableCount: available.length,
    confidence,
    grade,
    explanation: {
      unavailableKeys,
      renormalized: unavailableKeys.length > 0,
      availabilityCoverage,
      evidenceConfidence,
      weakestDimensionKey,
      formulaVersion: PARTIAL_COMPOSITE_CONFIDENCE_FORMULA_VERSION,
      causes,
    },
  };
}

/** Pure grade helper for tests — exposes model thresholds without U floor. */
export function gradePartialCompositeScore(
  score: number,
  thresholds: ScoreModelConfig["gradeThresholds"],
): Exclude<Grade, "U"> {
  return gradeScore(score, thresholds);
}
