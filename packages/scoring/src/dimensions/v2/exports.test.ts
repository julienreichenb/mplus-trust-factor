/**
 * Smoke test: four Scoring V2 calculators + shadow helpers are exported
 * from the package root barrel (@mplus/scoring).
 */
import { describe, expect, it } from "vitest";
import * as scoring from "../../index.js";

describe("@mplus/scoring Scoring V2 exports", () => {
  it("exports Performance V2 compute, fingerprint, shadow, and calibration helpers", () => {
    expect(typeof scoring.computePerformanceV2).toBe("function");
    expect(typeof scoring.computePerformanceV2InputFingerprint).toBe("function");
    expect(typeof scoring.toPerformanceV2ShadowDimensionPayload).toBe("function");
    expect(typeof scoring.exportPerformanceV2Calibration).toBe("function");
    expect(scoring.PERFORMANCE_V2_ALGORITHM_VERSION).toBeTruthy();
  });

  it("exports Experience V3 compute, fingerprint, shadow, and calibration helpers", () => {
    expect(typeof scoring.computeExperienceV3).toBe("function");
    expect(typeof scoring.computeExperienceV3InputFingerprint).toBe("function");
    expect(typeof scoring.toExperienceV3ShadowDimensionPayload).toBe("function");
    expect(typeof scoring.exportExperienceV3Calibration).toBe("function");
    expect(scoring.EXPERIENCE_V3_ALGORITHM_VERSION).toBeTruthy();
  });

  it("exports Survival V2 compute, fingerprint, shadow, and calibration helpers", () => {
    expect(typeof scoring.computeSurvivalV2).toBe("function");
    expect(typeof scoring.buildSurvivalV2InputFingerprint).toBe("function");
    expect(typeof scoring.toSurvivalV2ShadowDimensionPayload).toBe("function");
    expect(typeof scoring.exportSurvivalV2Calibration).toBe("function");
    expect(scoring.SURVIVAL_V2_ALGORITHM_VERSION).toBeTruthy();
  });

  it("exports Utility V2 compute, fingerprint, shadow, and calibration helpers", () => {
    expect(typeof scoring.computeUtilityV2).toBe("function");
    expect(typeof scoring.computeUtilityV2InputFingerprint).toBe("function");
    expect(typeof scoring.toUtilityV2ShadowDimensionPayload).toBe("function");
    expect(typeof scoring.exportUtilityV2Calibration).toBe("function");
    expect(scoring.UTILITY_V2_ALGORITHM_VERSION).toBeTruthy();
    expect(scoring.UTILITY_V2_SCORE_FLOOR).toBe(50);
  });

  it("exports shared shadow normalization helpers", () => {
    expect(typeof scoring.normalizeShadowDimensionRecord).toBe("function");
    expect(typeof scoring.buildUnavailableShadowDimensionRecord).toBe("function");
    expect(typeof scoring.availabilityFromComputeState).toBe("function");
    expect(typeof scoring.availabilityFromUtilityResult).toBe("function");
    expect(scoring.DIMENSION_COMPUTATION_LIFECYCLE_SHADOW).toBe("SHADOW");
  });
});
