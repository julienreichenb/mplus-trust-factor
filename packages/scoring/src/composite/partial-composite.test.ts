import { describe, expect, it } from "vitest";
import {
  computePartialComposite,
  defaultSkillDimensionWeights,
} from "./partial-composite.js";

const v6Thresholds = { S: 90, A: 80, B: 65, C: 50 };

describe("computePartialComposite", () => {
  const v6 = defaultSkillDimensionWeights({
    performance: 0.35,
    survival: 0.3,
    utility: 0.25,
    experienceConsistency: 0.1,
  });

  it("P+U+S available, E missing → composite + letter grade (not U) + reduced confidence", () => {
    const full = computePartialComposite(
      [
        { key: "performance", score: 83.16, available: true, baseWeight: v6.performance, confidence: 0.9 },
        { key: "survival", score: 74.27, available: true, baseWeight: v6.survival, confidence: 0.85 },
        { key: "utility", score: 61.88, available: true, baseWeight: v6.utility, confidence: 0.8 },
        { key: "experience", score: 90, available: true, baseWeight: v6.experience, confidence: 0.9 },
      ],
      { gradeThresholds: v6Thresholds, minConfidenceForGrade: 0.35 },
    );
    const partial = computePartialComposite(
      [
        { key: "performance", score: 83.16, available: true, baseWeight: v6.performance, confidence: 0.9 },
        { key: "survival", score: 74.27, available: true, baseWeight: v6.survival, confidence: 0.85 },
        { key: "utility", score: 61.88, available: true, baseWeight: v6.utility, confidence: 0.8 },
        { key: "experience", score: null, available: false, baseWeight: v6.experience, confidence: null },
      ],
      { gradeThresholds: v6Thresholds, minConfidenceForGrade: 0.35 },
    );

    expect(partial.composite).not.toBeNull();
    expect(partial.grade).not.toBe("U");
    expect(partial.availableCount).toBe(3);
    expect(partial.availabilityCoverage).toBeCloseTo(0.9, 10);
    expect(partial.confidence).toBeLessThan(full.confidence);
    expect(partial.confidence).toBeCloseTo(0.8 * 0.9, 10);

    // Renormalized: 35/90, 30/90, 25/90
    expect(partial.effectiveWeights.performance).toBeCloseTo(35 / 90, 10);
    expect(partial.effectiveWeights.survival).toBeCloseTo(30 / 90, 10);
    expect(partial.effectiveWeights.utility).toBeCloseTo(25 / 90, 10);
    expect(partial.effectiveWeights.experience).toBeUndefined();

    const expected =
      83.16 * (35 / 90) + 74.27 * (30 / 90) + 61.88 * (25 / 90);
    expect(partial.composite).toBeCloseTo(expected, 6);
  });

  it("Experience unavailable is not treated as Experience = 0", () => {
    const asZero = computePartialComposite(
      [
        { key: "performance", score: 80, available: true, baseWeight: 0.35, confidence: 1 },
        { key: "survival", score: 80, available: true, baseWeight: 0.3, confidence: 1 },
        { key: "utility", score: 80, available: true, baseWeight: 0.25, confidence: 1 },
        { key: "experience", score: 0, available: true, baseWeight: 0.1, confidence: 1 },
      ],
      { gradeThresholds: v6Thresholds },
    );
    const unavailable = computePartialComposite(
      [
        { key: "performance", score: 80, available: true, baseWeight: 0.35, confidence: 1 },
        { key: "survival", score: 80, available: true, baseWeight: 0.3, confidence: 1 },
        { key: "utility", score: 80, available: true, baseWeight: 0.25, confidence: 1 },
        { key: "experience", score: null, available: false, baseWeight: 0.1, confidence: null },
      ],
      { gradeThresholds: v6Thresholds },
    );
    expect(unavailable.composite).toBeCloseTo(80, 10);
    expect(asZero.composite).toBeCloseTo(72, 10); // 80*0.9 + 0*0.1
    expect(unavailable.composite).toBeGreaterThan(asZero.composite!);
  });

  it("two dimensions available → renormalize across two", () => {
    const r = computePartialComposite(
      [
        { key: "performance", score: 100, available: true, baseWeight: 0.35, confidence: 1 },
        { key: "survival", score: 50, available: true, baseWeight: 0.3, confidence: 1 },
        { key: "utility", score: null, available: false, baseWeight: 0.25 },
        { key: "experience", score: null, available: false, baseWeight: 0.1 },
      ],
      { gradeThresholds: v6Thresholds },
    );
    expect(r.composite).toBeCloseTo(100 * (0.35 / 0.65) + 50 * (0.3 / 0.65), 6);
    expect(r.grade).not.toBe("U");
  });

  it("one dimension available → 100% of composite", () => {
    const r = computePartialComposite(
      [
        { key: "performance", score: 77, available: true, baseWeight: 0.35, confidence: 1 },
        { key: "survival", score: null, available: false, baseWeight: 0.3 },
        { key: "utility", score: null, available: false, baseWeight: 0.25 },
        { key: "experience", score: null, available: false, baseWeight: 0.1 },
      ],
      { gradeThresholds: v6Thresholds, minConfidenceForGrade: 0.35 },
    );
    expect(r.composite).toBeCloseTo(77, 10);
    expect(r.effectiveWeights.performance).toBeCloseTo(1, 10);
    // coverage 0.35 × evidence 1.0 = 0.35 → presentGrade allows grade at exact floor
    expect(r.confidence).toBeCloseTo(0.35, 10);
    expect(r.grade).not.toBe("U");
  });

  it("zero dimensions available → null composite and U", () => {
    const r = computePartialComposite(
      [
        { key: "performance", score: null, available: false, baseWeight: 0.35 },
        { key: "survival", score: null, available: false, baseWeight: 0.3 },
        { key: "utility", score: null, available: false, baseWeight: 0.25 },
        { key: "experience", score: null, available: false, baseWeight: 0.1 },
      ],
      { gradeThresholds: v6Thresholds },
    );
    expect(r.composite).toBeNull();
    expect(r.grade).toBe("U");
    expect(r.confidence).toBe(0);
  });

  it("uses custom admin model weights for normalization", () => {
    const weights = defaultSkillDimensionWeights({
      performance: 0.5,
      survival: 0.2,
      utility: 0.2,
      experienceConsistency: 0.1,
    });
    const r = computePartialComposite(
      [
        { key: "performance", score: 100, available: true, baseWeight: weights.performance, confidence: 1 },
        { key: "survival", score: 0, available: true, baseWeight: weights.survival, confidence: 1 },
        { key: "utility", score: 0, available: true, baseWeight: weights.utility, confidence: 1 },
        { key: "experience", score: null, available: false, baseWeight: weights.experience },
      ],
      { gradeThresholds: v6Thresholds },
    );
    // Among available: 0.5+0.2+0.2=0.9 → P gets 0.5/0.9
    expect(r.effectiveWeights.performance).toBeCloseTo(0.5 / 0.9, 10);
    expect(r.composite).toBeCloseTo(100 * (0.5 / 0.9), 6);
  });
});
