import { describe, expect, it } from "vitest";
import { computeSurvivalDimension } from "./aggregate.js";

describe("computeSurvivalDimension", () => {
  it("uses supplied component medians for v4 observations", () => {
    const result = computeSurvivalDimension({
      dungeons: [
        {
          dungeonSlug: "test-dungeon",
          medianBehavioralScore: 70,
          runCount: 2,
        },
      ],
      expectedDungeonCount: 8,
      componentMedians: {
        outcome: 80,
        defensiveResponse: 60,
        emergencyRecovery: 40,
      },
      analyzedRunCount: 2,
      cachedRunCount: 1,
      newlyFetchedRunCount: 1,
    });

    expect(result.observations).toEqual({
      "survival.outcome": 80,
      "survival.defensive_response": 60,
      "survival.emergency_recovery": 40,
    });
    expect(result.summary.components).toEqual({
      outcome: 80,
      defensiveResponse: 60,
      emergencyRecovery: 40,
    });
    expect(result.survivalScore).toBe(68);
    expect(result.summary.analyzedRunCount).toBe(2);
  });
});
