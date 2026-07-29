import { describe, expect, it } from "vitest";
import { selectCohort, DEFAULT_COHORT_CONFIG } from "./cohort-selector.js";

describe("cohort selector", () => {
  const candidates = [
    {
      characterId: "c1",
      region: "EU",
      realmSlug: "archimonde",
      name: "Wallidrixe",
      mythicRating: 2845,
      lastPublicRefreshAt: new Date(Date.now() - 200_000_000),
      lastViewedAt: new Date(),
      priority: 10,
    },
    {
      characterId: "c2",
      region: "EU",
      realmSlug: "kazzak",
      name: "LowRated",
      mythicRating: 1500,
      lastPublicRefreshAt: new Date(Date.now() - 200_000_000),
      lastViewedAt: null,
      priority: 1,
    },
    {
      characterId: "c3",
      region: "EU",
      realmSlug: "tarren-mill",
      name: "FreshElite",
      mythicRating: 3000,
      lastPublicRefreshAt: new Date(),
      lastViewedAt: new Date(),
      priority: 5,
    },
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
});
