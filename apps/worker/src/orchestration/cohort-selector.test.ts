import { describe, expect, it } from "vitest";
import {
  selectCohort,
  DEFAULT_COHORT_CONFIG,
  buildScheduledRefreshJobKey,
  type CohortCandidate,
} from "./cohort-selector.js";

function candidate(partial: Partial<CohortCandidate> & Pick<CohortCandidate, "characterId" | "name">): CohortCandidate {
  return {
    region: "EU",
    realmSlug: "archimonde",
    mythicRating: 2800,
    lastPublicRefreshAt: new Date(Date.now() - 200_000_000),
    lastSeenAt: new Date(),
    lastViewedAt: null,
    hasPublishedScore: true,
    specRole: "DPS",
    priority: 1,
    ...partial,
  };
}

describe("cohort selector", () => {
  const candidates = [
    candidate({
      characterId: "c1",
      name: "Wallidrixe",
      mythicRating: 2845,
      lastViewedAt: new Date(),
      priority: 10,
    }),
    candidate({
      characterId: "c2",
      name: "LowRated",
      realmSlug: "kazzak",
      mythicRating: 1500,
      priority: 1,
    }),
    candidate({
      characterId: "c3",
      name: "FreshElite",
      realmSlug: "tarren-mill",
      mythicRating: 3000,
      lastPublicRefreshAt: new Date(),
      lastViewedAt: new Date(),
      priority: 5,
    }),
  ];

  it("ON_DEMAND returns empty cohort", () => {
    const result = selectCohort({ ...DEFAULT_COHORT_CONFIG, strategy: "ON_DEMAND" }, candidates);
    expect(result.candidates).toHaveLength(0);
  });

  it("RATING_THRESHOLD filters by minimum rating", () => {
    const result = selectCohort(
      { ...DEFAULT_COHORT_CONFIG, strategy: "RATING_THRESHOLD", ratingThreshold: 2500 },
      candidates,
      { freshnessTtlMs: 86_400_000 },
    );
    expect(result.candidates.every((c) => (c.mythicRating ?? 0) >= 2500)).toBe(true);
    expect(result.skippedFresh).toBeGreaterThanOrEqual(1);
  });

  it("respects WCL budget unavailability", () => {
    const result = selectCohort(
      { ...DEFAULT_COHORT_CONFIG, strategy: "DAILY_ELITE_COHORT" },
      candidates,
      { wclBudgetAvailable: false },
    );
    expect(result.candidates).toHaveLength(0);
    expect(result.skippedNoBudget).toBe(candidates.length);
  });

  it("DAILY_ELITE_COHORT uses lastSeenAt for activity", () => {
    const withActivity = [
      candidate({
        characterId: "active",
        name: "Active",
        mythicRating: 2600,
        lastSeenAt: new Date(),
      }),
      candidate({
        characterId: "inactive",
        name: "Inactive",
        mythicRating: 2600,
        lastSeenAt: new Date(Date.now() - 40 * 86_400_000),
      }),
    ];
    const result = selectCohort(
      {
        ...DEFAULT_COHORT_CONFIG,
        strategy: "DAILY_ELITE_COHORT",
        ratingThreshold: 2500,
        activityWithinDays: 14,
      },
      withActivity,
      { freshnessTtlMs: 86_400_000 },
    );
    expect(result.candidates.map((c) => c.characterId)).toEqual(["active"]);
  });

  it("TRACKED_PERCENTILE requires an explicit denominator", () => {
    expect(() =>
      selectCohort({ ...DEFAULT_COHORT_CONFIG, strategy: "TRACKED_PERCENTILE" }, candidates),
    ).toThrow(/requires an explicit CohortDenominator/);
  });

  it("selection is deterministic for the same inputs", () => {
    const config = {
      ...DEFAULT_COHORT_CONFIG,
      strategy: "PUBLISHED_AND_STALE" as const,
    };
    const a = selectCohort(config, candidates, { nowMs: 1_700_000_000_000, freshnessTtlMs: 86_400_000 });
    const b = selectCohort(config, candidates, { nowMs: 1_700_000_000_000, freshnessTtlMs: 86_400_000 });
    expect(a.selectionFingerprint).toBe(b.selectionFingerprint);
    expect(a.candidates.map((c) => c.characterId)).toEqual(b.candidates.map((c) => c.characterId));
  });

  it("buildScheduledRefreshJobKey is stable", () => {
    const a = buildScheduledRefreshJobKey({
      characterId: "c1",
      cadenceTier: "A",
      strategy: "DAILY_ELITE_COHORT",
      plannedDatasets: ["wcl.zone_rankings", "blizzard.character_profile"],
    });
    const b = buildScheduledRefreshJobKey({
      characterId: "c1",
      cadenceTier: "A",
      strategy: "DAILY_ELITE_COHORT",
      plannedDatasets: ["blizzard.character_profile", "wcl.zone_rankings"],
    });
    expect(a).toBe(b);
  });
});
