/**
 * Dimension + global confidence formula tests (Agent 04).
 */
import { describe, expect, it } from "vitest";
import {
  buildDimensionConfidenceBreakdown,
  computePartialComposite,
  computePerformancePhase2Confidence,
  calculateExperiencePhase1,
  confidenceBandFromUnit,
} from "../index.js";
import { computeSurvivalV2Confidence } from "../survival/v2/aggregate.js";
import type { OffensiveCooldownDisciplineResult } from "../performance/phase2/cooldown-discipline.js";

function emptyCooldown(
  overrides: Partial<OffensiveCooldownDisciplineResult> = {},
): OffensiveCooldownDisciplineResult {
  return {
    score: 90,
    selectedRunCount: 16,
    cooldownUsableRunCount: 16,
    eligibleAbilityCount: 1,
    evaluatedAbilityCount: 1,
    unsupportedAbilityIds: [],
    catalogueIncompatibleRuns: [],
    runsWithoutValidDuration: [],
    runScores: [],
    ...overrides,
  };
}

describe("confidenceBandFromUnit", () => {
  it("maps unit confidence to coverage bands", () => {
    expect(confidenceBandFromUnit(1)).toBe("HIGH");
    expect(confidenceBandFromUnit(0.85)).toBe("HIGH");
    expect(confidenceBandFromUnit(0.7)).toBe("MEDIUM");
    expect(confidenceBandFromUnit(0.4)).toBe("LOW");
    expect(confidenceBandFromUnit(0)).toBe("NONE");
  });
});

describe("Performance Phase 2 confidence blend", () => {
  it("full Phase1 + complete cooldown evidence → inherits full Phase1 confidence", () => {
    const result = computePerformancePhase2Confidence({
      phase1Confidence: 1,
      phase1Limits: [],
      weightsApplied: { phase1: 0.8, cooldown: 0.2 },
      cooldown: emptyCooldown(),
      combinedScore: 95,
    });
    expect(result.confidence).toBeCloseTo(1, 10);
    expect(result.causes).toEqual([]);
    expect(result.components.cooldownEvidenceConfidence).toBe(1);
  });

  it("strong Phase1 + incomplete cooldown coverage lowers confidence without score invention", () => {
    const result = computePerformancePhase2Confidence({
      phase1Confidence: 1,
      phase1Limits: [],
      weightsApplied: { phase1: 0.8, cooldown: 0.2 },
      cooldown: emptyCooldown({
        cooldownUsableRunCount: 8,
        selectedRunCount: 16,
      }),
      combinedScore: 92,
    });
    // 0.8*1 + 0.2*0.5 = 0.9
    expect(result.confidence).toBeCloseTo(0.9, 10);
    expect(result.causes).toContain("incomplete_cooldown_run_coverage");
    expect(result.breakdown.band).toBe("HIGH");
  });

  it("complete cooldown + weaker Phase1 remains limited by Phase1 share", () => {
    const result = computePerformancePhase2Confidence({
      phase1Confidence: 0.5,
      phase1Limits: ["profile_only"],
      weightsApplied: { phase1: 0.8, cooldown: 0.2 },
      cooldown: emptyCooldown(),
      combinedScore: 80,
    });
    // 0.8*0.5 + 0.2*1 = 0.6
    expect(result.confidence).toBeCloseTo(0.6, 10);
    expect(result.causes).toContain("profile_only");
    expect(result.causes).not.toContain("incomplete_cooldown_run_coverage");
  });

  it("cooldown unavailable (Phase1-only fallback) keeps Phase1 confidence + cause", () => {
    const result = computePerformancePhase2Confidence({
      phase1Confidence: 0.9,
      phase1Limits: [],
      weightsApplied: { phase1: 1, cooldown: 0 },
      cooldown: emptyCooldown({
        score: null,
        cooldownUsableRunCount: 0,
        evaluatedAbilityCount: 0,
      }),
      combinedScore: 85,
    });
    expect(result.confidence).toBeCloseTo(0.9, 10);
    expect(result.causes).toContain("cooldown_evidence_unavailable");
  });

  it("does not treat unresolved talent skips as cooldown coverage loss", () => {
    const result = computePerformancePhase2Confidence({
      phase1Confidence: 1,
      phase1Limits: [],
      weightsApplied: { phase1: 0.8, cooldown: 0.2 },
      cooldown: emptyCooldown({
        // usable runs remain complete even when other talent CDs were skipped
        cooldownUsableRunCount: 16,
        selectedRunCount: 16,
        evaluatedAbilityCount: 1,
      }),
      combinedScore: 94,
    });
    expect(result.confidence).toBe(1);
    expect(result.causes).not.toContain("talent_availability_unknown");
  });
});

describe("Survival confidence causes", () => {
  it("full evidence with unmeasured catalog → confidence 1 without invented catalog cause", () => {
    const result = computeSurvivalV2Confidence({
      dungeonCount: 8,
      expectedDungeonCount: 8,
      scoredRunCount: 16,
      expectedSlotCount: 16,
      healthModes: { FULL: 16, PARTIAL: 0, OUTCOME_ONLY: 0, TRUNCATED: 0, MISSING: 0 },
      catalogCoverageMean: 1,
      relativeUnreliableCount: 0,
      catalogCoverageUnmeasured: true,
    });
    expect(result.confidence).toBeCloseTo(1, 10);
    expect(result.causes).not.toContain("incomplete_catalog_coverage");
    expect(result.causes).not.toContain("digest_catalog_coverage_unmeasured");
  });

  it("max-HP unavailable emits machine-readable cause and lowers health factor", () => {
    const result = computeSurvivalV2Confidence({
      dungeonCount: 8,
      expectedDungeonCount: 8,
      scoredRunCount: 16,
      expectedSlotCount: 16,
      healthModes: { FULL: 0, PARTIAL: 0, OUTCOME_ONLY: 16, TRUNCATED: 0, MISSING: 0 },
      catalogCoverageMean: 0,
      relativeUnreliableCount: 0,
      catalogCoverageUnmeasured: true,
    });
    expect(result.confidence).toBeLessThan(1);
    expect(result.causes).toContain("max_hp_unavailable");
    expect(result.causes).toContain("health_evidence_outcome_dominated");
  });
});

describe("Experience Phase 1 confidence", () => {
  it("resolved confirmed absence → score 0 available confidence 1", () => {
    const result = calculateExperiencePhase1({
      previous: { state: "CONFIRMED_NO_ACTIVITY" },
      elite: { state: "OK", confirmedCount: 0 },
    });
    expect(result.available).toBe(true);
    expect(result.score).toBe(0);
    expect(result.confidence).toBe(1);
    expect(result.confidenceCauses).toEqual([]);
  });

  it("provider/integrity failure → unavailable with machine cause", () => {
    const result = calculateExperiencePhase1({
      previous: { state: "UNAVAILABLE", reason: "rio_timeout" },
      elite: { state: "UNAVAILABLE", reason: "blizzard_timeout" },
    });
    expect(result.available).toBe(false);
    expect(result.score).toBeNull();
    expect(result.confidence).toBeNull();
    expect(result.confidenceCauses).toContain("historical_evidence_unavailable");
  });
});

describe("partial composite weakest-link provenance", () => {
  it("full evidence → confidence 1 with empty limiter causes", () => {
    const result = computePartialComposite([
      { key: "performance", score: 95, available: true, baseWeight: 0.35, confidence: 1 },
      { key: "survival", score: 80, available: true, baseWeight: 0.3, confidence: 1 },
      { key: "utility", score: 70, available: true, baseWeight: 0.25, confidence: 1 },
      { key: "experience", score: 0, available: true, baseWeight: 0.1, confidence: 1 },
    ]);
    expect(result.confidence).toBeCloseTo(1, 10);
    expect(result.explanation.evidenceConfidence).toBe(1);
    expect(result.explanation.weakestDimensionKey).toBe("performance");
    expect(result.explanation.causes).toEqual([]);
    expect(result.explanation.formulaVersion).toBe(
      "partial-composite-weakest-link-v1",
    );
  });

  it("weakest-link selects min dimension and surfaces its causes", () => {
    const result = computePartialComposite([
      {
        key: "performance",
        score: 95,
        available: true,
        baseWeight: 0.35,
        confidence: 0.7,
        confidenceCauses: ["incomplete_cooldown_run_coverage"],
      },
      { key: "survival", score: 80, available: true, baseWeight: 0.3, confidence: 0.95 },
      { key: "utility", score: 70, available: true, baseWeight: 0.25, confidence: 0.9 },
      { key: "experience", score: 0, available: true, baseWeight: 0.1, confidence: 1 },
    ]);
    expect(result.confidence).toBeCloseTo(0.7, 10);
    expect(result.explanation.weakestDimensionKey).toBe("performance");
    expect(result.explanation.causes).toContain("weakest_link:performance");
    expect(result.explanation.causes).toContain(
      "incomplete_cooldown_run_coverage",
    );
  });

  it("unavailable Experience reduces coverage; valid-zero Experience does not", () => {
    const withZero = computePartialComposite([
      { key: "performance", score: 90, available: true, baseWeight: 0.35, confidence: 1 },
      { key: "survival", score: 80, available: true, baseWeight: 0.3, confidence: 1 },
      { key: "utility", score: 70, available: true, baseWeight: 0.25, confidence: 1 },
      { key: "experience", score: 0, available: true, baseWeight: 0.1, confidence: 1 },
    ]);
    const missing = computePartialComposite([
      { key: "performance", score: 90, available: true, baseWeight: 0.35, confidence: 1 },
      { key: "survival", score: 80, available: true, baseWeight: 0.3, confidence: 1 },
      { key: "utility", score: 70, available: true, baseWeight: 0.25, confidence: 1 },
      { key: "experience", score: null, available: false, baseWeight: 0.1, confidence: null },
    ]);
    expect(withZero.confidence).toBeCloseTo(1, 10);
    expect(missing.availabilityCoverage).toBeCloseTo(0.9, 10);
    expect(missing.confidence).toBeCloseTo(0.9, 10);
    expect(missing.explanation.causes).toContain(
      "dimension_unavailable:experience",
    );
  });
});

describe("buildDimensionConfidenceBreakdown", () => {
  it("omits causes when confidence is full and none supplied", () => {
    const b = buildDimensionConfidenceBreakdown({ value: 1, causes: [] });
    expect(b.causes).toEqual([]);
    expect(b.band).toBe("HIGH");
  });
});
