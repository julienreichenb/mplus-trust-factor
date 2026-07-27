import { describe, expect, it } from "vitest";
import {
  assertRegionPresent,
  assertScoreRange,
  assertConfidenceRange,
  assertGradeMatchesThresholds,
  assertDimensionWeightsSumToOne,
  assertNoDuplicateFingerprints,
  assertNoDuplicateAnalysis,
  assertMissingNotFabricatedZero,
  assertAddonExportSafe,
  collectViolations,
} from "@mplus/test-utils";

describe("data-quality invariants", () => {
  const thresholds = { S: 90, A: 80, B: 65, C: 50 };

  it("requires region on identity", () => {
    expect(assertRegionPresent("EU")).toBeNull();
    expect(assertRegionPresent("")).not.toBeNull();
  });

  it("enforces score and confidence ranges", () => {
    expect(assertScoreRange(50)).toBeNull();
    expect(assertScoreRange(101)).not.toBeNull();
    expect(assertConfidenceRange(0.5)).toBeNull();
    expect(assertConfidenceRange(1.5)).not.toBeNull();
  });

  it("validates grade against thresholds", () => {
    expect(assertGradeMatchesThresholds(92, "S", thresholds)).toBeNull();
    expect(assertGradeMatchesThresholds(92, "B", thresholds)).not.toBeNull();
  });

  it("requires dimension weights to sum to 1", () => {
    expect(
      assertDimensionWeightsSumToOne({
        performance: 0.32,
        survival: 0.27,
        utility: 0.23,
        experienceConsistency: 0.13,
        mythicRaid: 0.05,
      }),
    ).toBeNull();
    expect(
      assertDimensionWeightsSumToOne({
        performance: 0.5,
        survival: 0.5,
        utility: 0.5,
        experienceConsistency: 0,
        mythicRaid: 0,
      }),
    ).not.toBeNull();
  });

  it("detects duplicate run fingerprints", () => {
    expect(assertNoDuplicateFingerprints(["a", "b"])).toBeNull();
    expect(assertNoDuplicateFingerprints(["a", "a"])).not.toBeNull();
  });

  it("detects duplicate analysis keys", () => {
    expect(assertNoDuplicateAnalysis(["run1:v1", "run2:v1"])).toBeNull();
    expect(assertNoDuplicateAnalysis(["run1:v1", "run1:v1"])).not.toBeNull();
  });

  it("rejects fabricated zero for missing metrics", () => {
    expect(assertMissingNotFabricatedZero(null, null, "metric")).toBeNull();
    expect(assertMissingNotFabricatedZero(null, 0, "metric")).not.toBeNull();
    expect(assertMissingNotFabricatedZero(0, 0, "metric")).toBeNull();
  });

  it("rejects premium/admin fields in addon export", () => {
    expect(
      assertAddonExportSafe({
        region: "EU",
        score: 85,
        grade: "A",
      }),
    ).toBeNull();
    expect(assertAddonExportSafe({ premiumDetails: true })).not.toBeNull();
    expect(assertAddonExportSafe({ rawPayload: {} })).not.toBeNull();
  });

  it("collects multiple violations", () => {
    const report = collectViolations(assertScoreRange(150), assertConfidenceRange(2));
    expect(report.ok).toBe(false);
    expect(report.violations).toHaveLength(2);
  });
});
