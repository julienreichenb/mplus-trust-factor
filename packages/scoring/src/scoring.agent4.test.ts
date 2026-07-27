import { describe, expect, it } from "vitest";
import type { MetricObservationDTO } from "@mplus/contracts";
import {
  applyHistoricalDecay,
  calculateAuthenticity,
  calculateDimensionScores,
  calculateFinalTrust,
  calculateMetricScores,
  calculateScore,
  computeInputFingerprint,
  createDefaultModelV1,
  createSurvivalFocusedModel,
  createUtilityFocusedModel,
  gradeScore,
  normalizeRawValue,
  validateScoreModelConfig,
  type AuthenticityFeatureInput,
  type ScoreExplanation,
  type ScoreModelConfigV1,
} from "./index.js";
import { PROFILES, type ScoringProfileFixture } from "../../../tools/fixtures/scoring/profiles.js";

function observationsFromProfile(profile: ScoringProfileFixture): MetricObservationDTO[] {
  return profile.metrics.map((m) => ({
    metricKey: m.metricKey,
    dimension: m.dimension,
    rawValue: m.normalizedValue,
    normalizedValue: m.normalizedValue,
    confidence: m.confidence,
    observedAt: "2026-07-01T12:00:00.000Z",
    sourceProvider: m.sourceProvider,
    coverage:
      m.normalizedValue == null
        ? { present: 0, expected: 1, ratio: 0 }
        : { present: 1, expected: 1, ratio: 1 },
    context: m.context ?? { sampleSize: 20 },
  }));
}

function scoreProfile(profile: ScoringProfileFixture, model: ScoreModelConfigV1 = createDefaultModelV1()) {
  const observations = observationsFromProfile(profile);
  const context = {
    role: profile.role,
    classSlug: profile.classSlug,
    specSlug: profile.specSlug,
    freshness: profile.freshness,
    selectedRunCoverage: profile.selectedRunCoverage,
    authenticity: profile.authenticity as AuthenticityFeatureInput,
    mechanicCatalogVersion: "0.1.0-seed",
  };
  const fingerprint = computeInputFingerprint({
    characterId: profile.characterId,
    seasonSlug: profile.seasonSlug,
    model,
    scopeType: "CHARACTER",
    scopeKey: null,
    observations,
    context,
  });
  return calculateScore({
    characterId: profile.characterId,
    seasonSlug: profile.seasonSlug,
    model,
    scopeType: "CHARACTER",
    scopeKey: null,
    observations,
    calculatedAt: "2026-07-01T12:00:00.000Z",
    inputFingerprint: fingerprint,
    context,
  });
}

const GRADE_ORDER = ["D", "C", "B", "A", "S"] as const;

describe("Agent 4: scoring and authenticity engine", () => {
  it("validates default model config", () => {
    const result = validateScoreModelConfig(createDefaultModelV1());
    expect(result.ok).toBe(true);
  });

  it("rejects invalid weights and unordered grades", () => {
    const bad = createDefaultModelV1({
      weights: {
        performance: 0.5,
        survival: 0.5,
        utility: 0,
        experienceConsistency: 0,
        mythicRaid: 0.2,
      },
      gradeThresholds: { S: 50, A: 80, B: 65, C: 50 },
      normalization: { bad: { type: "not-a-type" as "identity" } },
    });
    const result = validateScoreModelConfig(bad);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("clamps scores and grades at boundaries", () => {
    const model = createDefaultModelV1();
    expect(gradeScore(90, model.gradeThresholds)).toBe("S");
    expect(gradeScore(89.9, model.gradeThresholds)).toBe("A");
    expect(gradeScore(50, model.gradeThresholds)).toBe("C");
    expect(gradeScore(49.9, model.gradeThresholds)).toBe("D");
    expect(normalizeRawValue(150, { type: "identity" })).toBe(100);
    expect(normalizeRawValue(-10, { type: "identity" })).toBe(0);
  });

  it("redistributes available metric weights and shrinks missing data toward neutral", () => {
    const model = createDefaultModelV1();
    const observations: MetricObservationDTO[] = [
      {
        metricKey: "performance.mythic_rating",
        dimension: "PERFORMANCE",
        rawValue: 100,
        normalizedValue: 100,
        confidence: 1,
        observedAt: "2026-07-01T12:00:00.000Z",
        sourceProvider: "fixture",
        coverage: { present: 1, expected: 1, ratio: 1 },
        context: { sampleSize: 30 },
      },
    ];
    const dims = calculateDimensionScores(observations, model, { role: "DPS" });
    const perf = dims.find((d) => d.dimension === "PERFORMANCE")!;
    expect(perf.rawScore).toBe(100);
    expect(perf.coverage).toBeLessThan(1);
    expect(perf.adjustedScore).toBeLessThan(100);
    expect(perf.adjustedScore).toBeGreaterThan(50);
    expect(perf.missing.length).toBeGreaterThan(0);
  });

  it("applies confidence shrinkage toward neutral", () => {
    const model = createDefaultModelV1();
    const high = calculateFinalTrust({
      skillScore: 90,
      authenticityScore: 100,
      confidence: 1,
      model,
    });
    const low = calculateFinalTrust({
      skillScore: 90,
      authenticityScore: 100,
      confidence: 0,
      model,
    });
    expect(high.overallScore).toBeGreaterThan(80);
    expect(low.overallScore).toBe(50);
  });

  it("is deterministic and fingerprint-stable", () => {
    const profile = PROFILES[0]!;
    const a = scoreProfile(profile);
    const b = scoreProfile(profile);
    expect(a).toEqual(b);
    expect(a.inputFingerprint).toBe(b.inputFingerprint);
    expect(a.inputFingerprint).toHaveLength(64);
  });

  it("applies historical decay across seasons", () => {
    const decay = createDefaultModelV1().historicalDecay;
    const combined = applyHistoricalDecay(
      { current: 90, previous: 60, older: 30 },
      decay,
    );
    expect(combined).toBeCloseTo(90 * 0.7 + 60 * 0.2 + 30 * 0.1, 5);
  });

  it("tags aggressive boost with sufficient evidence and skips with insufficient evidence", () => {
    const model = createDefaultModelV1();
    const boost = calculateAuthenticity(
      {
        progressionKeyJump: 1,
        compressedBestRunWindow: 1,
        lowVolumeForScore: 1,
        repeatedStrongerTeammates: 1,
        topRunRosterConcentration: 1,
        weakTargetPerformance: 1,
        highDeathsLowContribution: 1,
        lackIntermediateProgression: 1,
      },
      model,
    );
    expect(boost.tags).toContain("BOOST_SUSPECTED");
    expect(boost.redFlags.some((f) => f.key === "boost_suspected")).toBe(true);
    expect(JSON.stringify(boost)).not.toMatch(/bought a boost/i);

    const sparse = calculateAuthenticity({}, model);
    expect(sparse.tags).toContain("INSUFFICIENT_DATA");
    expect(sparse.tags).not.toContain("BOOST_SUSPECTED");
  });

  it("applies reroll mitigation without erasing poor performance evidence", () => {
    const model = createDefaultModelV1();
    const without = calculateAuthenticity(
      {
        progressionKeyJump: 1,
        weakTargetPerformance: 1,
        highDeathsLowContribution: 1,
      },
      model,
    );
    const withReroll = calculateAuthenticity(
      {
        progressionKeyJump: 1,
        weakTargetPerformance: 1,
        highDeathsLowContribution: 1,
        confirmedEliteMain: 1,
        isConfirmedReroll: true,
      },
      model,
    );
    expect(withReroll.authenticityScore).toBeGreaterThan(without.authenticityScore);
    const perfEvidence = withReroll.evidence.filter(
      (e) =>
        e.featureKey === "weakTargetPerformance" ||
        e.featureKey === "highDeathsLowContribution",
    );
    expect(perfEvidence.every((e) => e.contribution < 0)).toBe(true);
    expect(withReroll.tags).toContain("CONFIRMED_REROLL");
  });

  it("exposes explainability contributors", () => {
    const snapshot = scoreProfile(PROFILES[0]!);
    const explanation = snapshot.explanation as ScoreExplanation;
    expect(explanation.publicSummary.length).toBeGreaterThan(20);
    expect(explanation.adminDetail).toContain("model=default@1");
    expect(explanation.topPositive.length).toBeGreaterThan(0);
  });

  it("runs role-specific tank and healer paths", () => {
    const tank = scoreProfile(PROFILES.find((p) => p.id === "08-tank")!);
    const healer = scoreProfile(PROFILES.find((p) => p.id === "09-healer")!);
    expect(tank.overallScore).toBeGreaterThanOrEqual(70);
    expect(healer.overallScore).toBeGreaterThanOrEqual(65);
    expect(tank.dimensions.some((d) => d.dimension === "SURVIVAL")).toBe(true);
  });

  it("property: no NaN and all scores in range for golden cohort", () => {
    for (const profile of PROFILES) {
      const snapshot = scoreProfile(profile);
      const nums = [
        snapshot.overallScore,
        snapshot.skillScore,
        snapshot.authenticityScore,
        snapshot.confidence,
        ...snapshot.dimensions.map((d) => d.score),
        ...snapshot.dimensions.map((d) => d.confidence),
      ];
      for (const n of nums) {
        expect(Number.isFinite(n)).toBe(true);
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThanOrEqual(100);
      }
      expect(snapshot.confidence).toBeLessThanOrEqual(1);
    }
  });

  it("golden cohort expectations", () => {
    for (const profile of PROFILES.filter((p) => p.id !== "10-model-variants")) {
      const snapshot = scoreProfile(profile);
      const exp = profile.expectations;
      if (!exp) continue;
      if (exp.overallMin != null) expect(snapshot.overallScore).toBeGreaterThanOrEqual(exp.overallMin);
      if (exp.overallMax != null) expect(snapshot.overallScore).toBeLessThanOrEqual(exp.overallMax);
      if (exp.authenticityMax != null) {
        expect(snapshot.authenticityScore).toBeLessThanOrEqual(exp.authenticityMax);
      }
      if (exp.authenticityMin != null) {
        expect(snapshot.authenticityScore).toBeGreaterThanOrEqual(exp.authenticityMin);
      }
      if (exp.confidenceMax != null) {
        expect(snapshot.confidence).toBeLessThanOrEqual(exp.confidenceMax);
      }
      const flags = snapshot.redFlags.map((f) => f.key);
      const explanation = snapshot.explanation as { authenticityHighlights?: unknown };
      void explanation;
      const tagBlob = JSON.stringify(snapshot);
      if (exp.tagsInclude) {
        for (const tag of exp.tagsInclude) {
          expect(tagBlob).toContain(tag === "BOOST_SUSPECTED" ? "boost_suspected" : tag === "INSUFFICIENT_DATA" ? "insufficient_data" : tag === "CONFIRMED_REROLL" ? "confirmed_reroll" : tag);
        }
      }
      if (exp.tagsExclude?.includes("BOOST_SUSPECTED")) {
        expect(flags).not.toContain("boost_suspected");
      }
      if (exp.gradeMin) {
        expect(GRADE_ORDER.indexOf(snapshot.grade as (typeof GRADE_ORDER)[number])).toBeGreaterThanOrEqual(
          GRADE_ORDER.indexOf(exp.gradeMin as (typeof GRADE_ORDER)[number]),
        );
      }
      if (exp.gradeMax) {
        expect(GRADE_ORDER.indexOf(snapshot.grade as (typeof GRADE_ORDER)[number])).toBeLessThanOrEqual(
          GRADE_ORDER.indexOf(exp.gradeMax as (typeof GRADE_ORDER)[number]),
        );
      }
    }
  });

  it("model variants shift score for the same player", () => {
    const profile = PROFILES.find((p) => p.id === "10-model-variants")!;
    const def = scoreProfile(profile, createDefaultModelV1());
    const survival = scoreProfile(profile, createSurvivalFocusedModel());
    const utility = scoreProfile(profile, createUtilityFocusedModel());
    expect(survival.overallScore).toBeGreaterThan(def.overallScore);
    expect(utility.overallScore).toBeLessThan(def.overallScore);
  });

  it("calculateMetricScores returns configured metrics", () => {
    const model = createDefaultModelV1();
    const metrics = calculateMetricScores([], model, { role: "DPS" });
    expect(metrics.every((m) => !m.available)).toBe(true);
    expect(metrics.length).toBeGreaterThan(10);
  });
});
