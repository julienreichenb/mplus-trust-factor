import { describe, expect, it } from "vitest";
import { computeModelCoverage, MODEL_COVERAGE_PROVISIONAL_THRESHOLD } from "./model-coverage.js";
import { createDefaultModelV3, createDefaultModelV4 } from "./model/defaults.js";
import type { DimensionScoreResult } from "./types.js";

function dim(
  dimension: DimensionScoreResult["dimension"],
  weight: number,
  confidence: number,
  hasContributors: boolean,
): DimensionScoreResult {
  return {
    dimension,
    rawScore: 60,
    adjustedScore: 60,
    confidence,
    coverage: confidence,
    weight,
    contributors: hasContributors
      ? [
          {
            metricKey: "test.metric",
            dimension,
            normalizedValue: 60,
            confidence,
            weight: 1,
            available: true,
            rawValue: 60,
            sourceProvider: "test",
          },
        ]
      : [],
    missing: [],
  };
}

describe("computeModelCoverage", () => {
  it("uses Survival V1.1.1 metric weights in v4", () => {
    expect(createDefaultModelV4().metricWeights.SURVIVAL).toEqual([
      { metricKey: "survival.outcome", weight: 0.55 },
      { metricKey: "survival.defensive_response", weight: 0.3 },
      { metricKey: "survival.emergency_recovery", weight: 0.15 },
    ]);
  });

  it("marks overall provisional when more than half model weight is unavailable", () => {
    const model = createDefaultModelV3();
    const dimensions = [
      dim("PERFORMANCE", model.weights.performance, 0.8, true),
      dim("SURVIVAL", model.weights.survival, 0, false),
      dim("UTILITY", model.weights.utility, 0, false),
      dim("EXPERIENCE", model.weights.experienceConsistency, 0.7, true),
      dim("RAID", model.weights.mythicRaid, 0, false),
    ];
    const summary = computeModelCoverage(dimensions, model);
    expect(summary.totalModelWeight).toBeCloseTo(1, 5);
    expect(summary.availableModelWeight).toBeCloseTo(0.45, 2);
    expect(summary.modelCoverageRatio).toBeCloseTo(0.45, 2);
    expect(summary.modelCoverageRatio).toBeLessThan(MODEL_COVERAGE_PROVISIONAL_THRESHOLD);
    expect(summary.overallState).toBe("PROVISIONAL");
    expect(summary.provisionalReason).toContain("MODEL_COVERAGE_BELOW_THRESHOLD");
  });
});
