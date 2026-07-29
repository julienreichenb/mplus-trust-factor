import { describe, expect, it } from "vitest";
import {
  buildCharacterHistoryExperienceObservations,
  calculateScore,
  createDefaultModelV2,
} from "../index.js";

/**
 * Lock current (pre-V2) Experience CHARACTER_HISTORY behavior before replacement.
 * Do not change these expectations when evolving Experience V2.
 */
describe("Experience V1 CHARACTER_HISTORY lock (pre-replacement)", () => {
  it("emits breadth, top_level_repeat, volume_recency, historical_seasons, role_continuity, mythic_rating", () => {
    const observations = buildCharacterHistoryExperienceObservations({
      observedAt: "2026-07-28T12:00:00.000Z",
      expectedDungeonCount: 8,
      selectedRuns: [
        { dungeonSlug: "a", keyLevel: 12, timed: true, completedAt: "2026-07-20T12:00:00.000Z" },
        { dungeonSlug: "b", keyLevel: 12, timed: true, completedAt: "2026-07-20T12:00:00.000Z" },
        { dungeonSlug: "c", keyLevel: 10, timed: true, completedAt: "2026-07-20T12:00:00.000Z" },
      ],
      mythicRatingObservation: {
        metricKey: "experience.mythic_rating",
        dimension: "EXPERIENCE",
        rawValue: 2800,
        normalizedValue: 78,
        confidence: 0.75,
        observedAt: "2026-07-28T12:00:00.000Z",
        sourceProvider: "blizzard",
        coverage: null,
        context: { notAParsePercentile: true },
      },
      priorSeasonCount: 1,
      roleContinuity: 1,
    });

    const keys = observations.map((o) => o.metricKey).sort();
    expect(keys).toEqual([
      "experience.dungeon_breadth",
      "experience.historical_seasons",
      "experience.mythic_rating",
      "experience.role_continuity",
      "experience.top_level_repeat",
      "experience.volume_recency",
    ]);

    const breadth = observations.find((o) => o.metricKey === "experience.dungeon_breadth")!;
    expect(breadth.rawValue).toBe(3);
    expect(breadth.normalizedValue).toBeCloseTo((3 / 8) * 100, 5);

    const peak = observations.find((o) => o.metricKey === "experience.top_level_repeat")!;
    expect(peak.rawValue).toBe(2);
    expect(peak.context).toMatchObject({ peakKeyLevel: 12 });
  });

  it("scores Experience under model v2 weights including mythic_rating", () => {
    const observations = buildCharacterHistoryExperienceObservations({
      observedAt: "2026-07-28T12:00:00.000Z",
      expectedDungeonCount: 8,
      selectedRuns: Array.from({ length: 8 }, (_, i) => ({
        dungeonSlug: `dungeon-${i + 1}`,
        keyLevel: 10,
        timed: true,
        completedAt: "2026-07-20T12:00:00.000Z",
      })),
      mythicRatingObservation: {
        metricKey: "experience.mythic_rating",
        dimension: "EXPERIENCE",
        rawValue: 2800,
        normalizedValue: 78,
        confidence: 0.75,
        observedAt: "2026-07-28T12:00:00.000Z",
        sourceProvider: "blizzard",
        coverage: null,
        context: {},
      },
      priorSeasonCount: 1,
      roleContinuity: 1,
    });

    const snapshot = calculateScore({
      characterId: "11111111-1111-1111-1111-111111111111",
      seasonSlug: "season-test",
      model: createDefaultModelV2(),
      scopeType: "CHARACTER",
      scopeKey: null,
      observations,
      calculatedAt: "2026-07-28T12:00:00.000Z",
      inputFingerprint: "exp-v1-lock",
      context: { role: "DPS", freshness: 0.7, selectedRunCoverage: 0 },
    });

    const experience = snapshot.dimensions.find((d) => d.dimension === "EXPERIENCE")!;
    expect(experience.state).toBe("AVAILABLE");
    expect(experience.score).not.toBeNull();
    const available = (experience.contributors as { available?: Array<{ metricKey: string }> })
      .available;
    expect(available?.some((c) => c.metricKey === "experience.mythic_rating")).toBe(true);
  });
});
