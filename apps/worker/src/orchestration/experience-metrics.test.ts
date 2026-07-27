import { describe, expect, it } from "vitest";
import type { RaiderIoCharacterProfile } from "@mplus/contracts";
import { buildExperienceObservations } from "./experience-metrics.js";
import { EXPERIENCE_V3_METRIC_KEYS } from "@mplus/scoring";

function profile(overrides: Partial<RaiderIoCharacterProfile> = {}): RaiderIoCharacterProfile {
  return {
    region: "EU",
    realmSlug: "archimonde",
    normalizedName: "wallidrixe",
    displayName: "Wallidrixe",
    classSlug: "warlock",
    specSlug: "demonology",
    role: "DPS",
    profileUrl: "https://raider.io/characters/eu/archimonde/Wallidrixe",
    lastCrawledAt: "2026-07-27T12:00:00.000Z",
    crawlStale: false,
    gear: null,
    talents: null,
    currentSeason: {
      seasonSlug: "season-mn-1",
      scores: { all: 2845, dps: 2845, healer: null, tank: null },
      isCurrentSeason: true,
      isPreviousSeason: false,
    },
    previousSeason: {
      seasonSlug: "season-tww-3",
      scores: { all: 3012, dps: 3012, healer: null, tank: null },
      isCurrentSeason: false,
      isPreviousSeason: true,
    },
    seasons: [
      {
        seasonSlug: "season-mn-1",
        scores: { all: 2845, dps: 2845, healer: null, tank: null },
        isCurrentSeason: true,
        isPreviousSeason: false,
      },
      {
        seasonSlug: "season-tww-3",
        scores: { all: 3012, dps: 3012, healer: null, tank: null },
        isCurrentSeason: false,
        isPreviousSeason: true,
      },
    ],
    ranks: null,
    recentRuns: [],
    bestRuns: [],
    highestLevelRuns: [],
    raidProgression: [],
    runHistoryIncomplete: false,
    representedRunCount: 0,
    attribution: {
      provider: "raiderio",
      displayText: "Data from Raider.IO",
      homepageUrl: "https://raider.io",
      profileUrl: "https://raider.io/characters/eu/archimonde/Wallidrixe",
      sourceUrl: null,
    },
    ...overrides,
  };
}

describe("buildExperienceObservations", () => {
  it("emits CHARACTER_HISTORY labels and never invents account alts for Wallidrixe", () => {
    const result = buildExperienceObservations({
      characterKey: "eu/archimonde/wallidrixe",
      displayName: "Wallidrixe",
      raiderIoProfile: profile(),
      blizzardMythicRating: 2800,
      cutoffs: {
        region: "EU",
        seasonSlug: "season-mn-1",
        updatedAt: "2026-07-27T00:00:00.000Z",
        top25Percent: { score: 2700, quantile: "p750", label: "top_25_percent" },
        attribution: {
          provider: "raiderio",
          displayText: "Data from Raider.IO",
          homepageUrl: "https://raider.io",
          profileUrl: null,
          sourceUrl: null,
        },
      },
      currentSeasonDungeonCount: 8,
      expectedDungeonCount: 8,
      observedAt: "2026-07-28T00:00:00.000Z",
    });

    expect(result.summary.mode).toBe("CHARACTER_HISTORY");
    expect(result.summary.label).toBe("CHARACTER_HISTORY");
    expect(result.summary.accountGraph.availability).toBe("BLOCKED");
    expect(result.summary.missingMetrics).toContain("account_linked_alts");
    expect(result.observations.some((o) => o.metricKey === EXPERIENCE_V3_METRIC_KEYS.currentPeak)).toBe(
      true,
    );
    expect(
      result.observations.some((o) => o.metricKey === EXPERIENCE_V3_METRIC_KEYS.currentBreadth),
    ).toBe(true);
    expect(result.observations.some((o) => o.metricKey === "experience.dungeon_breadth")).toBe(true);
    expect(result.experienceScore).not.toBeNull();
  });

  it("treats missing alt graph as unavailable metric, not a low experience score", () => {
    const result = buildExperienceObservations({
      characterKey: "eu/archimonde/wallidrixe",
      displayName: "Wallidrixe",
      raiderIoProfile: profile(),
      blizzardMythicRating: 2800,
      cutoffs: null,
      currentSeasonDungeonCount: 8,
      expectedDungeonCount: 8,
      observedAt: "2026-07-28T00:00:00.000Z",
    });
    expect(result.summary.accountGraph.availability).toBe("BLOCKED");
    expect(result.experienceScore).toBeGreaterThan(40);
    expect(result.summary.missingMetrics).toContain("account_linked_alts");
    expect(result.summary.missingMetrics).not.toContain("experience.current_peak");
  });
});
