import { describe, expect, it } from "vitest";
import {
  buildExperienceV2Observations,
  calculateScore,
  createDefaultModelV5,
  presentDimensionScore,
} from "./index.js";
import type { DimensionScoreResult } from "./types.js";

describe("presentDimensionScore", () => {
  const base: DimensionScoreResult = {
    dimension: "SURVIVAL",
    rawScore: 50,
    adjustedScore: 50,
    confidence: 0,
    coverage: 0,
    weight: 0.3,
    contributors: [],
    missing: [] as DimensionScoreResult["missing"],
  };

  it("serializes neutral internal fallback as UNAVAILABLE with null public score", () => {
    const dto = presentDimensionScore(base);
    expect(dto.score).toBeNull();
    expect(dto.confidence).toBe(0);
    expect(dto.state).toBe("UNAVAILABLE");
  });

  it("marks partial coverage", () => {
    const dto = presentDimensionScore({
      ...base,
      confidence: 0.25,
      coverage: 0.3,
      contributors: [{ metricKey: "survival.death_rate" } as never],
      adjustedScore: 72,
    });
    expect(dto.state).toBe("PARTIAL");
    expect(dto.score).toBe(72);
  });

  it("marks available dimensions", () => {
    const dto = presentDimensionScore({
      ...base,
      confidence: 0.8,
      coverage: 0.9,
      contributors: [{ metricKey: "survival.death_rate" } as never],
      adjustedScore: 81,
    });
    expect(dto.state).toBe("AVAILABLE");
    expect(dto.score).toBe(81);
  });
});

describe("Experience CHARACTER_HISTORY independence", () => {
  it("computes Experience without WCL details and without alt inference", () => {
    const observations = buildExperienceV2Observations({
      observedAt: "2026-07-28T12:00:00.000Z",
      expectedDungeonCount: 8,
      selectedRuns: Array.from({ length: 8 }, (_, i) => ({
        dungeonSlug: `dungeon-${i + 1}`,
        keyLevel: 10 + (i % 3),
        completedAt: "2026-07-20T12:00:00.000Z",
      })),
      priorSeasonCount: 1,
      provenance: "HAS_HISTORY",
    });

    expect(observations.some((o) => o.metricKey === "experience.dungeon_breadth")).toBe(true);
    expect(
      observations.every(
        (o) => (o.context as { independentOfWclDetails?: boolean }).independentOfWclDetails !== false,
      ),
    ).toBe(true);
    expect(JSON.stringify(observations)).not.toContain("alt");

    const snapshot = calculateScore({
      characterId: "11111111-1111-1111-1111-111111111111",
      seasonSlug: "season-test",
      model: createDefaultModelV5(),
      scopeType: "CHARACTER",
      scopeKey: null,
      observations,
      calculatedAt: "2026-07-28T12:00:00.000Z",
      inputFingerprint: "exp-no-wcl",
      context: { role: "DPS", freshness: 0.7, selectedRunCoverage: 0 },
    });

    const experience = snapshot.dimensions.find((d) => d.dimension === "EXPERIENCE")!;
    expect(experience.state).toBe("AVAILABLE");
    expect(experience.score).not.toBeNull();
    expect(experience.score!).toBeGreaterThan(50);

    const survival = snapshot.dimensions.find((d) => d.dimension === "SURVIVAL")!;
    const utility = snapshot.dimensions.find((d) => d.dimension === "UTILITY")!;
    expect(survival.state).toBe("UNAVAILABLE");
    expect(utility.state).toBe("UNAVAILABLE");
    expect(survival.score).toBeNull();
    expect(utility.score).toBeNull();

    expect(snapshot.modelVersion).toBe(5);
    expect(createDefaultModelV5().weights.mythicRaid).toBe(0);
    expect(createDefaultModelV5().weights.performance).toBe(0.35);
    expect(createDefaultModelV5().weights.experienceConsistency).toBe(0.1);
  });
});
