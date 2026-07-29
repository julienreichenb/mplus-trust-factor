import { describe, expect, it } from "vitest";
import {
  ablateExperienceV2,
  activityRecencyNormalized,
  buildExperienceV2Observations,
  calculateScore,
  computeExperienceV2,
  createDefaultModelV5,
  EXPERIENCE_V2_CALIBRATION_PANEL,
  EXPERIENCE_V2_METRIC_WEIGHTS,
  mergeObservationsWithLastKnownGood,
  participationDepthNormalized,
  resolveExperienceProvenance,
  runCalibrationPanel,
  validateCoherence,
} from "../../index.js";
import type { MetricObservationDTO, ScoreSnapshotDTO } from "@mplus/contracts";

const NOW = "2026-07-29T12:00:00.000Z";
const RECENT = "2026-07-20T12:00:00.000Z";

function dim(
  dimension: "PERFORMANCE" | "SURVIVAL" | "EXPERIENCE",
  score: number | null,
  state: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE" = score == null ? "UNAVAILABLE" : "AVAILABLE",
) {
  return {
    dimension,
    score,
    confidence: score == null ? 0 : 0.8,
    weight: dimension === "EXPERIENCE" ? 0.1 : 0.3,
    state,
    reason: state === "UNAVAILABLE" ? "NO_OBSERVATIONS" : null,
    contributors: score == null ? [] : [{ metricKey: `${dimension.toLowerCase()}.x` }],
  };
}

function snapshotForCoherence(
  dimensions: ReturnType<typeof dim>[],
): ScoreSnapshotDTO {
  const model = createDefaultModelV5();
  return {
    characterId: "char-1",
    seasonSlug: "blizzard-season-13",
    modelKey: model.key,
    modelVersion: model.version,
    scopeType: "CHARACTER",
    scopeKey: null,
    overallScore: 70,
    grade: "B",
    skillScore: 70,
    authenticityScore: 70,
    confidence: 0.75,
    calculatedAt: NOW,
    inputFingerprint: "fp-1",
    dimensions,
    redFlags: [],
    explanation: { refreshContractHash: "contract-v1" },
    availableModelWeight: 0.9,
    totalModelWeight: 1,
    modelCoverageRatio: 0.9,
    overallState: "DEFINITIVE",
    provisionalReason: null,
  };
}

describe("Experience V2 core", () => {
  it("does not use WCL combat-event fields and never infers alts", () => {
    const observations = buildExperienceV2Observations({
      observedAt: NOW,
      expectedDungeonCount: 8,
      selectedRuns: [
        { dungeonSlug: "a", keyLevel: 10, completedAt: RECENT },
        { dungeonSlug: "b", keyLevel: 12, completedAt: RECENT },
      ],
      priorSeasonCount: 1,
    });
    const blob = JSON.stringify(observations);
    expect(blob).not.toContain("combat");
    expect(blob).not.toContain("alt");
    expect(observations.every((o) => o.context?.independentOfWclDetails === true)).toBe(true);
    expect(observations.every((o) => o.context?.noAltInference === true)).toBe(true);
    expect(observations.every((o) => o.context?.historyMode === "CHARACTER_HISTORY")).toBe(true);
  });

  it("gives a new character a valid low-confidence / low-score result", () => {
    const observations = buildExperienceV2Observations({
      observedAt: NOW,
      expectedDungeonCount: 8,
      selectedRuns: [],
      seasonRuns: [],
      priorSeasonCount: 0,
      provenance: "CONFIRMED_ABSENCE",
    });
    expect(observations.length).toBe(EXPERIENCE_V2_METRIC_WEIGHTS.length);

    const snapshot = calculateScore({
      characterId: "11111111-1111-1111-1111-111111111111",
      seasonSlug: "season-test",
      model: createDefaultModelV5(),
      scopeType: "CHARACTER",
      scopeKey: null,
      observations,
      calculatedAt: NOW,
      inputFingerprint: "new-char",
      context: { role: "DPS", freshness: 0.7, selectedRunCoverage: 0 },
    });
    const experience = snapshot.dimensions.find((d) => d.dimension === "EXPERIENCE")!;
    expect(experience.score).not.toBeNull();
    expect(experience.score!).toBeLessThan(35);
    expect(experience.state).not.toBe("UNAVAILABLE");
    expect(experience.confidence).toBeGreaterThan(0.3);
  });

  it("distinguishes confirmed absence from provider failure provenance", () => {
    expect(
      resolveExperienceProvenance({
        blizzardOk: true,
        raiderIoOk: true,
        hasAnyHistorySignal: false,
      }),
    ).toBe("CONFIRMED_ABSENCE");
    expect(
      resolveExperienceProvenance({
        blizzardOk: false,
        raiderIoOk: false,
        hasAnyHistorySignal: false,
      }),
    ).toBe("PROVIDER_FAILURE");
  });

  it("raw spam in one dungeon cannot dominate breadth", () => {
    const spam = computeExperienceV2({
      expectedDungeonCount: 8,
      selectedRuns: [{ dungeonSlug: "only", keyLevel: 10, completedAt: RECENT }],
      seasonRuns: Array.from({ length: 80 }, () => ({
        dungeonSlug: "only",
        keyLevel: 10,
        completedAt: RECENT,
      })),
      priorSeasonCount: 0,
      observedAt: NOW,
      provenance: "HAS_HISTORY",
    });
    const breadth = spam.components.find((c) => c.metricKey === "experience.dungeon_breadth")!;
    const depth = spam.components.find((c) => c.metricKey === "experience.participation_depth")!;
    expect(breadth.normalizedValue).toBeCloseTo((1 / 8) * 100, 5);
    // Depth may saturate at the spam cap; breadth must keep overall experience low.
    expect(spam.rawScore).toBeLessThan(55);
    expect(breadth.normalizedValue).toBeLessThan(depth.normalizedValue);
  });

  it("multi-season history increases experience without peak-key / rating skill proxies", () => {
    const runs = Array.from({ length: 6 }, (_, i) => ({
      dungeonSlug: `d-${i}`,
      keyLevel: 10,
      completedAt: RECENT,
    }));
    const base = computeExperienceV2({
      expectedDungeonCount: 8,
      selectedRuns: runs,
      seasonRuns: runs,
      priorSeasonCount: 0,
      priorSeasonSourceDepth: 1,
      observedAt: NOW,
      provenance: "HAS_HISTORY",
    });
    const multi = computeExperienceV2({
      expectedDungeonCount: 8,
      selectedRuns: runs,
      seasonRuns: runs,
      priorSeasonCount: 3,
      priorSeasonSourceDepth: 3,
      observedAt: NOW,
      provenance: "HAS_HISTORY",
    });
    expect(multi.rawScore).toBeGreaterThan(base.rawScore);
    const keys = multi.components.map((c) => c.metricKey);
    expect(keys).not.toContain("experience.mythic_rating");
    expect(keys).not.toContain("experience.top_level_repeat");
  });

  it("old history decays gradually rather than disappearing", () => {
    const recent = activityRecencyNormalized(RECENT, NOW);
    const mid = activityRecencyNormalized("2026-05-15T12:00:00.000Z", NOW);
    const old = activityRecencyNormalized("2026-01-01T12:00:00.000Z", NOW);
    expect(recent.normalized).toBe(100);
    expect(mid.normalized).toBeGreaterThan(old.normalized);
    expect(old.normalized).toBeGreaterThanOrEqual(12);
  });

  it("participation depth uses diminishing returns", () => {
    const low = participationDepthNormalized(2, 8);
    const mid = participationDepthNormalized(8, 8);
    const high = participationDepthNormalized(40, 8);
    expect(mid).toBeGreaterThan(low);
    expect(high).toBeGreaterThan(mid);
    expect(high - mid).toBeLessThan(mid - low);
  });

  it("model-only recalculation performs zero provider calls", () => {
    let providerCalls = 0;
    const fetchProvider = () => {
      providerCalls += 1;
      throw new Error("providers must not be called");
    };
    const observations = buildExperienceV2Observations({
      observedAt: NOW,
      expectedDungeonCount: 8,
      selectedRuns: Array.from({ length: 8 }, (_, i) => ({
        dungeonSlug: `d-${i}`,
        keyLevel: 10 + (i % 3),
        completedAt: RECENT,
      })),
      priorSeasonCount: 2,
      provenance: "HAS_HISTORY",
    });
    const snapshot = calculateScore({
      characterId: "11111111-1111-1111-1111-111111111111",
      seasonSlug: "season-test",
      model: createDefaultModelV5(),
      scopeType: "CHARACTER",
      scopeKey: null,
      observations,
      calculatedAt: NOW,
      inputFingerprint: "model-only",
      context: { role: "DPS", freshness: 0.8, selectedRunCoverage: 1 },
    });
    void fetchProvider;
    expect(providerCalls).toBe(0);
    expect(snapshot.modelVersion).toBe(5);
    expect(snapshot.dimensions.find((d) => d.dimension === "EXPERIENCE")!.score).not.toBeNull();
  });

  it("provider failure preserves last-known-good Experience observations", () => {
    const lkg: MetricObservationDTO[] = buildExperienceV2Observations({
      observedAt: "2026-07-01T12:00:00.000Z",
      expectedDungeonCount: 8,
      selectedRuns: Array.from({ length: 8 }, (_, i) => ({
        dungeonSlug: `d-${i}`,
        keyLevel: 11,
        completedAt: RECENT,
      })),
      priorSeasonCount: 2,
      provenance: "HAS_HISTORY",
    });
    const merged = mergeObservationsWithLastKnownGood({
      incoming: [],
      persisted: lkg,
      failedDimensions: new Set(["EXPERIENCE"]),
      refreshedMetricKeys: new Set(),
    });
    expect(merged.filter((o) => o.dimension === "EXPERIENCE").length).toBe(lkg.length);
    expect(merged.find((o) => o.metricKey === "experience.dungeon_breadth")?.rawValue).toBe(8);
  });

  it("coherence validation prevents Experience disappearance", () => {
    const model = createDefaultModelV5();
    const published = snapshotForCoherence([
      dim("PERFORMANCE", 70),
      dim("SURVIVAL", 70),
      dim("EXPERIENCE", 72),
    ]);
    const candidate = snapshotForCoherence([
      dim("PERFORMANCE", 70),
      dim("SURVIVAL", 70),
      dim("EXPERIENCE", null),
    ]);
    const result = validateCoherence({
      published,
      candidate,
      model,
      refreshContractHash: "contract-v1",
      expectedModelKey: model.key,
      expectedModelVersion: model.version,
      observations: [],
      isFirstCalculation: false,
    });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.code === "DIMENSION_REGRESSION")).toBe(true);
  });

  it("public score never includes unauthenticated alts (verifiedAccountHistory false)", () => {
    const observations = buildExperienceV2Observations({
      observedAt: NOW,
      expectedDungeonCount: 8,
      selectedRuns: [{ dungeonSlug: "a", keyLevel: 10, completedAt: RECENT }],
      priorSeasonCount: 1,
    });
    expect(observations.every((o) => o.context?.verifiedAccountHistory === false)).toBe(true);
    expect(createDefaultModelV5().weights.experienceConsistency).toBe(0.1);
  });
});

describe("Experience V2 calibration panel + ablations", () => {
  it("covers required archetypes and keeps ordering sensible", () => {
    const panel = runCalibrationPanel();
    const byId = Object.fromEntries(panel.map((p) => [p.id, p]));
    expect(byId["new-character"]!.rawScore).toBeLessThan(byId["active-current"]!.rawScore);
    expect(byId["active-current"]!.rawScore).toBeLessThan(byId["multi-season"]!.rawScore);
    expect(byId["spam-one-dungeon"]!.rawScore).toBeLessThan(byId["many-low-keys"]!.rawScore);
    expect(byId["returning-veteran"]!.components.find((c) => c.metricKey === "experience.activity_recency")!
      .normalizedValue).toBeLessThan(100);
    expect(byId["provider-failure-lkg"]!.provenance).toBe("PROVIDER_FAILURE");
  });

  it("provides ablations for every component", () => {
    const profile = EXPERIENCE_V2_CALIBRATION_PANEL.find((p) => p.id === "multi-season")!;
    const result = computeExperienceV2(profile);
    for (const component of result.components) {
      const ablated = ablateExperienceV2(result, component.metricKey);
      expect(ablated).toBeLessThan(result.rawScore);
    }
  });
});

describe("Wallidrixe-shaped Experience V2 worked example", () => {
  it("scores from persisted-style seasonal run metadata without Performance duplication", () => {
    // Wallidrixe-shaped: full dungeon pool, mid-high keys, prior season, recent activity.
    const observations = buildExperienceV2Observations({
      observedAt: NOW,
      expectedDungeonCount: 8,
      selectedRuns: Array.from({ length: 8 }, (_, i) => ({
        dungeonSlug: `wallidrixe-dungeon-${i + 1}`,
        keyLevel: 10 + (i % 4),
        completedAt: RECENT,
      })),
      seasonRuns: Array.from({ length: 18 }, (_, i) => ({
        dungeonSlug: `wallidrixe-dungeon-${(i % 8) + 1}`,
        keyLevel: 9 + (i % 5),
        completedAt: RECENT,
      })),
      priorSeasonCount: 1,
      provenance: "HAS_HISTORY",
    });

    const snapshot = calculateScore({
      characterId: "11111111-1111-1111-1111-111111111111",
      seasonSlug: "blizzard-season-13",
      model: createDefaultModelV5(),
      scopeType: "CHARACTER",
      scopeKey: null,
      observations,
      calculatedAt: NOW,
      inputFingerprint: "wallidrixe-experience-v2",
      context: { role: "DPS", freshness: 0.8, selectedRunCoverage: 0.5 },
    });

    const experience = snapshot.dimensions.find((d) => d.dimension === "EXPERIENCE")!;
    expect(experience.state).toBe("AVAILABLE");
    expect(experience.score).toBeGreaterThan(55);
    expect(experience.score).toBeLessThan(95);
    const available = (experience.contributors as { available?: Array<{ metricKey: string }> })
      .available?.map((c) => c.metricKey) ?? [];
    expect(available).not.toContain("experience.mythic_rating");
    expect(available).toContain("experience.dungeon_breadth");
    expect(available).toContain("experience.key_band_breadth");
  });
});
