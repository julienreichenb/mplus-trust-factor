import type { ScoreModelConfigV1 } from "./types.js";
import type { DimensionScoreResult } from "./types.js";

export const MODEL_COVERAGE_PROVISIONAL_THRESHOLD = 0.5;

export interface ModelCoverageSummary {
  availableModelWeight: number;
  totalModelWeight: number;
  modelCoverageRatio: number;
  overallState: "DEFINITIVE" | "PROVISIONAL";
  provisionalReason: string | null;
}

export function computeModelCoverage(
  dimensions: DimensionScoreResult[],
  model: ScoreModelConfigV1,
): ModelCoverageSummary {
  const weightedDimensions = dimensions.filter((d) => d.weight > 0);
  const totalModelWeight = weightedDimensions.reduce((sum, d) => sum + d.weight, 0);
  const availableModelWeight = weightedDimensions
    .filter((d) => d.confidence > 0 && d.contributors.length > 0)
    .reduce((sum, d) => sum + d.weight, 0);
  const modelCoverageRatio =
    totalModelWeight > 0 ? availableModelWeight / totalModelWeight : 0;
  const isProvisional = modelCoverageRatio < MODEL_COVERAGE_PROVISIONAL_THRESHOLD;
  return {
    availableModelWeight,
    totalModelWeight,
    modelCoverageRatio,
    overallState: isProvisional ? "PROVISIONAL" : "DEFINITIVE",
    provisionalReason: isProvisional
      ? `MODEL_COVERAGE_BELOW_THRESHOLD (${Math.round(modelCoverageRatio * 100)}% of model weight available; minimum ${Math.round(MODEL_COVERAGE_PROVISIONAL_THRESHOLD * 100)}%)`
      : null,
  };
}

/** Omit zero-weight dimensions (e.g. RAID on default@3) from public DTOs. */
export function filterPublicSkillDimensions<T extends { dimension: string; weight: number }>(
  dimensions: T[],
): T[] {
  return dimensions.filter((d) => d.weight > 0);
}
