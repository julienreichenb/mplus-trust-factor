import { describe, expect, it } from "vitest";
import {
  expectedSurvivalCompatibilityKey,
  isCompatibleSurvivalSummary,
} from "./wcl-survival-metrics.js";
import { SURVIVAL_STANDALONE_V1_1_1_CONFIG } from "@mplus/provider-warcraftlogs";
import { selectSurvivalAnalysisRuns } from "@mplus/scoring";

describe("survival production integration helpers", () => {
  it("reuses compatible run analysis and invalidates on revision change", () => {
    const key = expectedSurvivalCompatibilityKey({
      characterId: "char-1",
      reportCode: "Abc123",
      fightId: 4,
      reportRevision: 10,
      abilityCatalogVersion: "cat-1",
    });
    const summary = {
      compatibilityKey: key,
      analysisVersion: SURVIVAL_STANDALONE_V1_1_1_CONFIG.analysisVersion,
      behavioralSurvivalScore: 70.5,
    };
    expect(isCompatibleSurvivalSummary(summary, key)).toBe(true);

    const revisedKey = expectedSurvivalCompatibilityKey({
      characterId: "char-1",
      reportCode: "Abc123",
      fightId: 4,
      reportRevision: 11,
      abilityCatalogVersion: "cat-1",
    });
    expect(isCompatibleSurvivalSummary(summary, revisedKey)).toBe(false);
  });

  it("invalidates on ability catalog version change", () => {
    const key = expectedSurvivalCompatibilityKey({
      characterId: "char-1",
      reportCode: "Abc123",
      fightId: 4,
      reportRevision: 10,
      abilityCatalogVersion: "cat-1",
    });
    const next = expectedSurvivalCompatibilityKey({
      characterId: "char-1",
      reportCode: "Abc123",
      fightId: 4,
      reportRevision: 10,
      abilityCatalogVersion: "cat-2",
    });
    expect(key).not.toBe(next);
  });

  it("selects up to 3 WCL runs per active dungeon and excludes inactive", () => {
    const selection = selectSurvivalAnalysisRuns(
      [
        {
          canonicalRunId: "a1",
          dungeonSlug: "skyreach",
          keyLevel: 20,
          timed: true,
          completedAt: "2026-07-01T00:00:00.000Z",
          durationMs: 1,
          scoreValue: 300,
          hasWclSource: true,
        },
        {
          canonicalRunId: "a2",
          dungeonSlug: "skyreach",
          keyLevel: 19,
          timed: true,
          completedAt: "2026-07-02T00:00:00.000Z",
          durationMs: 1,
          scoreValue: 290,
          hasWclSource: true,
        },
        {
          canonicalRunId: "a3",
          dungeonSlug: "skyreach",
          keyLevel: 18,
          timed: true,
          completedAt: "2026-07-03T00:00:00.000Z",
          durationMs: 1,
          scoreValue: 280,
          hasWclSource: true,
        },
        {
          canonicalRunId: "a4",
          dungeonSlug: "skyreach",
          keyLevel: 17,
          timed: true,
          completedAt: "2026-07-04T00:00:00.000Z",
          durationMs: 1,
          scoreValue: 270,
          hasWclSource: true,
        },
        {
          canonicalRunId: "ice1",
          dungeonSlug: "icecrown",
          keyLevel: 25,
          timed: true,
          completedAt: "2026-07-01T00:00:00.000Z",
          durationMs: 1,
          scoreValue: 400,
          hasWclSource: true,
        },
      ],
      { allowedDungeonSlugs: ["skyreach"], maxRunsPerDungeon: 3 },
    );
    expect(selection.selectedRuns).toHaveLength(3);
    expect(selection.selectedRuns.every((r) => r.dungeonSlug === "skyreach")).toBe(true);
    expect(selection.selectedRuns.some((r) => r.dungeonSlug === "icecrown")).toBe(false);
  });
});
