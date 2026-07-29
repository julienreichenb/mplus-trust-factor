import { describe, expect, it } from "vitest";
import type { MetricObservationDTO } from "@mplus/contracts";
import { calculateScore } from "../calculate.js";
import { computeInputFingerprint } from "../fingerprint.js";
import { createDefaultModelV5, createDefaultModelV6 } from "./defaults.js";
import { calculateFinalTrust, calculateSkillScore } from "../trust.js";
import type { DimensionScoreResult } from "../types.js";

function obs(
  metricKey: string,
  dimension: MetricObservationDTO["dimension"],
  value: number,
  confidence = 0.95,
): MetricObservationDTO {
  return {
    metricKey,
    dimension,
    rawValue: value,
    normalizedValue: value,
    confidence,
    observedAt: "2026-07-30T00:00:00.000Z",
    sourceProvider: "warcraftlogs",
    coverage: { present: 1, expected: 1, ratio: 1 },
    context: {},
  };
}

/** Synthetic Wallidrixe-like finalized public dimensions → skillScore ≈ 72.1695 */
function wallidrixeLikeDimensions(): DimensionScoreResult[] {
  return [
    {
      dimension: "PERFORMANCE",
      rawScore: 79.65,
      adjustedScore: 79.53,
      confidence: 0.99,
      coverage: 1,
      weight: 0.35,
      contributors: [
        {
          metricKey: "performance.current_season_peak",
          dimension: "PERFORMANCE",
          rawValue: 80.875,
          normalizedValue: 80.875,
          weight: 0.65,
          available: true,
          confidence: 0.99,
          contribution: 52.57,
          sourceProvider: "warcraftlogs",
        },
      ],
      missing: [],
    },
    {
      dimension: "SURVIVAL",
      rawScore: 72,
      adjustedScore: 71.66,
      confidence: 0.9,
      coverage: 1,
      weight: 0.3,
      contributors: [
        {
          metricKey: "survival.outcome",
          dimension: "SURVIVAL",
          rawValue: 72,
          normalizedValue: 72,
          weight: 0.55,
          available: true,
          confidence: 0.9,
          contribution: 39.6,
          sourceProvider: "warcraftlogs",
        },
      ],
      missing: [],
    },
    {
      dimension: "UTILITY",
      rawScore: 61.91,
      adjustedScore: 60.16,
      confidence: 0.7,
      coverage: 1,
      weight: 0.25,
      contributors: [
        {
          metricKey: "utility.observed_contribution",
          dimension: "UTILITY",
          rawValue: 61.91,
          normalizedValue: 61.91,
          weight: 1,
          available: true,
          confidence: 0.7,
          contribution: 61.91,
          sourceProvider: "warcraftlogs",
        },
      ],
      missing: [],
    },
    {
      dimension: "EXPERIENCE",
      rawScore: 78,
      adjustedScore: 77.96,
      confidence: 0.88,
      coverage: 1,
      weight: 0.1,
      contributors: [
        {
          metricKey: "experience.dungeon_breadth",
          dimension: "EXPERIENCE",
          rawValue: 78,
          normalizedValue: 78,
          weight: 0.3,
          available: true,
          confidence: 0.88,
          contribution: 23.4,
          sourceProvider: "blizzard",
        },
      ],
      missing: [],
    },
    {
      dimension: "RAID",
      rawScore: 50,
      adjustedScore: 50,
      confidence: 0,
      coverage: 0,
      weight: 0,
      contributors: [],
      missing: [],
    },
  ];
}

describe("v6 WEIGHTED_DIMENSIONS overall formula", () => {
  it("seeds overallFormula=WEIGHTED_DIMENSIONS and v5 keeps legacy", () => {
    expect(createDefaultModelV6().overallFormula).toBe("WEIGHTED_DIMENSIONS");
    expect(createDefaultModelV5().overallFormula).toBe("LEGACY_AUTHENTICITY_CONFIDENCE_BLEND");
  });

  it("overall equals weighted public dimensions (~72.1695) and ignores authenticity/confidence blends", () => {
    const dims = wallidrixeLikeDimensions();
    const skill = calculateSkillScore(dims);
    expect(skill).toBeCloseTo(72.1695, 3);

    const v6 = createDefaultModelV6();
    const trust = calculateFinalTrust({
      skillScore: skill,
      authenticityScore: 40,
      confidence: 0.2,
      model: v6,
    });
    expect(trust.overallScore).toBeCloseTo(skill, 10);
    expect(trust.overallScore).toBeCloseTo(72.1695, 3);
    expect(trust.authenticityAppliedToOverall).toBe(false);
    expect(trust.globalConfidenceAppliedToOverall).toBe(false);
    expect(trust.authenticityScore).toBe(40);
    expect(trust.confidence).toBeCloseTo(0.2);
    // Low confidence still ungrades when below threshold.
    expect(trust.grade).toBe("U");
  });

  it("v5 legacy formula still applies authenticity + confidence blend", () => {
    const v5 = createDefaultModelV5();
    const high = calculateFinalTrust({
      skillScore: 90,
      authenticityScore: 100,
      confidence: 1,
      model: v5,
    });
    const low = calculateFinalTrust({
      skillScore: 90,
      authenticityScore: 100,
      confidence: 0,
      model: v5,
    });
    expect(high.authenticityAppliedToOverall).toBe(true);
    expect(high.globalConfidenceAppliedToOverall).toBe(true);
    expect(high.overallScore).toBeGreaterThan(80);
    expect(low.overallScore).toBe(50);
  });

  it("end-to-end calculateScore v6 uses weighted dimensions exactly once", () => {
    const model = createDefaultModelV6();
    const observations: MetricObservationDTO[] = [
      obs("performance.current_season_peak", "PERFORMANCE", 79.53),
      obs("performance.current_season_consistency", "PERFORMANCE", 79.53),
      obs("survival.outcome", "SURVIVAL", 71.66),
      obs("survival.defensive_response", "SURVIVAL", 71.66),
      obs("survival.emergency_recovery", "SURVIVAL", 71.66),
      obs("utility.observed_contribution", "UTILITY", 60.16, 0.7),
      obs("experience.dungeon_breadth", "EXPERIENCE", 77.96),
      obs("experience.key_band_breadth", "EXPERIENCE", 77.96),
      obs("experience.participation_depth", "EXPERIENCE", 77.96),
      obs("experience.historical_seasons", "EXPERIENCE", 77.96),
      obs("experience.activity_recency", "EXPERIENCE", 77.96),
    ];
    // Force high observation confidence so dimension adjusted ≈ raw public values.
    for (const o of observations) {
      o.confidence = 1;
      o.coverage = { present: 10, expected: 10, ratio: 1 };
    }

    const snapshot = calculateScore({
      characterId: "char-wallidrixe",
      seasonSlug: "test-season",
      model,
      scopeType: "CHARACTER",
      scopeKey: null,
      observations,
      calculatedAt: "2026-07-30T00:00:00.000Z",
      inputFingerprint: "test-fp",
      context: { role: "DPS", freshness: 1, selectedRunCoverage: 1 },
    });

    const perf = snapshot.dimensions.find((d) => d.dimension === "PERFORMANCE")!;
    const surv = snapshot.dimensions.find((d) => d.dimension === "SURVIVAL")!;
    const util = snapshot.dimensions.find((d) => d.dimension === "UTILITY")!;
    const exp = snapshot.dimensions.find((d) => d.dimension === "EXPERIENCE")!;
    expect(util.score).not.toBeNull();
    expect(snapshot.dimensions.filter((d) => d.dimension === "UTILITY")).toHaveLength(1);
    expect(snapshot.dimensions.filter((d) => d.dimension === "SURVIVAL")).toHaveLength(1);

    const expected =
      (perf.score ?? 0) * 0.35 +
      (surv.score ?? 0) * 0.3 +
      (util.score ?? 0) * 0.25 +
      (exp.score ?? 0) * 0.1;
    expect(snapshot.overallScore).toBeCloseTo(expected, 6);
    expect(snapshot.skillScore).toBeCloseTo(expected, 6);
    expect(snapshot.overallScore).toBeCloseTo(snapshot.skillScore, 10);

    const breakdown = (snapshot.explanation as { overallCalculation?: { overallScore: number; dimensions: Array<{ weightedContribution: number }>; authenticityAppliedToOverall: boolean; globalConfidenceAppliedToOverall: boolean; overallFormula: string } } | null)
      ?.overallCalculation;
    expect(breakdown?.overallFormula).toBe("WEIGHTED_DIMENSIONS");
    expect(breakdown?.authenticityAppliedToOverall).toBe(false);
    expect(breakdown?.globalConfidenceAppliedToOverall).toBe(false);
    const sumContrib = (breakdown?.dimensions ?? []).reduce((s, d) => s + d.weightedContribution, 0);
    expect(sumContrib).toBeCloseTo(snapshot.overallScore, 6);
  });

  it("excludes UNAVAILABLE dimensions from the weighted sum (not zero)", () => {
    const dims = wallidrixeLikeDimensions();
    dims[2] = {
      ...dims[2]!,
      confidence: 0,
      contributors: [],
      adjustedScore: 50,
    };
    const skill = calculateSkillScore(dims);
    // Renormalize over 0.35+0.30+0.10 = 0.75
    const expected = (79.53 * 0.35 + 71.66 * 0.3 + 77.96 * 0.1) / 0.75;
    expect(skill).toBeCloseTo(expected, 3);
    expect(skill).not.toBeCloseTo(72.1695, 1);
  });

  it("fingerprint includes overallFormula so old v6 snapshots invalidate", () => {
    const base = {
      characterId: "c1",
      seasonSlug: "s1",
      scopeType: "CHARACTER",
      scopeKey: null,
      observations: [] as MetricObservationDTO[],
      context: { role: "DPS" as const },
    };
    const legacy = computeInputFingerprint({
      ...base,
      model: { key: "default", version: 6, overallFormula: "LEGACY_AUTHENTICITY_CONFIDENCE_BLEND" },
    });
    const weighted = computeInputFingerprint({
      ...base,
      model: { key: "default", version: 6, overallFormula: "WEIGHTED_DIMENSIONS" },
    });
    expect(legacy).not.toBe(weighted);
  });
});
