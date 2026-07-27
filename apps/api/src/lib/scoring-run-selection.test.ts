import { describe, expect, it } from "vitest";
import { MIDNIGHT_S1_SEASON } from "@mplus/mechanics";
import {
  mapScoringRunSelectionProfile,
  resolveCombatCoverageState,
} from "./scoring-run-selection.js";

describe("scoring-run-selection profile mapping", () => {
  it("maps combat coverage states", () => {
    expect(
      resolveCombatCoverageState({
        wclReportMatched: true,
        detailAvailable: true,
        coverageRatio: 0.9,
      }),
    ).toBe("AVAILABLE");
    expect(
      resolveCombatCoverageState({
        wclReportMatched: true,
        detailAvailable: true,
        coverageRatio: 0.4,
      }),
    ).toBe("PARTIAL");
    expect(
      resolveCombatCoverageState({
        wclReportMatched: false,
        detailAvailable: false,
        coverageRatio: null,
      }),
    ).toBe("UNAVAILABLE");
  });

  it("exposes one selected run per dungeon with unavailable reasons", () => {
    const dungeonSlug = MIDNIGHT_S1_SEASON.dungeonSlugs[0]!;
    const profile = mapScoringRunSelectionProfile({
      seasonSlug: "blizzard-season-1",
      expectedDungeonCount: 8,
      dungeonSlugs: MIDNIGHT_S1_SEASON.dungeonSlugs,
      runs: [
        {
          runId: "high-unlogged",
          dungeonSlug,
          dungeonName: "Magisters' Terrace",
          seasonSlug: "blizzard-season-1",
          keyLevel: 20,
          timed: true,
          completedAt: "2026-07-20T12:00:00.000Z",
          durationMs: 1_800_000,
          raiderIoScore: 220,
          wclReportMatched: false,
          analysis: null,
        },
        {
          runId: "low-logged",
          dungeonSlug,
          dungeonName: "Magisters' Terrace",
          seasonSlug: "blizzard-season-1",
          keyLevel: 15,
          timed: true,
          completedAt: "2026-07-21T12:00:00.000Z",
          durationMs: 1_700_000,
          raiderIoScore: 180,
          wclReportMatched: true,
          analysis: { coverage: 0.9, detailAvailable: true },
        },
      ],
      observedAt: "2026-07-28T00:00:00.000Z",
    });

    expect(profile).not.toBeNull();
    expect(profile!.selectedRuns).toHaveLength(1);
    expect(profile!.selectedRuns[0]?.canonicalRunId).toBe("high-unlogged");
    expect(profile!.selectedRuns[0]?.combatCoverageState).toBe("UNAVAILABLE");
    expect(profile!.selectedRuns[0]?.unavailableReason).toBeTruthy();
    expect(profile!.selectedRuns[0]?.dungeonName).toBe("Magisters' Terrace");
    expect(profile!.selectedRuns[0]?.selectionReason).toBe("HIGHEST_KEY");
    expect(profile!.expectedDungeonCount).toBe(8);
    expect(profile!.missingDungeonSlugs.length).toBe(7);
  });
});
