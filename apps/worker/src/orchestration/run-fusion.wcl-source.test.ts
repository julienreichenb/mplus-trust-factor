import { describe, expect, it } from "vitest";
import type { MythicRunDTO } from "@mplus/contracts";
import { mythicRunHasWclSource, sourceRefHasWcl } from "./run-fusion.js";
import { selectScoringRuns } from "@mplus/scoring";

function runWithProvider(provider: string): MythicRunDTO {
  return {
    canonicalRunId: "run-1",
    dungeonSlug: "skyreach",
    keyLevel: 15,
    timed: true,
    completedAt: "2026-01-01T00:00:00.000Z",
    durationMs: 1_800_000,
    scoreValue: 400,
    participants: [],
    sources: [
      {
        provider: provider as "WARCRAFT_LOGS",
        externalRunId: "x",
        reportCode: "ABC123",
        fightId: 1,
        revision: 1,
      },
    ],
  };
}

describe("mythicRunHasWclSource", () => {
  it("recognizes WARCRAFT_LOGS regardless of provider string casing", () => {
    expect(mythicRunHasWclSource(runWithProvider("WARCRAFT_LOGS"))).toBe(true);
    expect(mythicRunHasWclSource(runWithProvider("warcraft_logs"))).toBe(true);
    expect(mythicRunHasWclSource(runWithProvider("Warcraft_Logs"))).toBe(true);
    expect(mythicRunHasWclSource(runWithProvider("BLIZZARD"))).toBe(false);
  });

  it("maps to wclReportMatched=true via selectScoringRuns when WCL source casing varies", () => {
    for (const provider of ["WARCRAFT_LOGS", "warcraft_logs", "Warcraft_Logs"]) {
      const selection = selectScoringRuns(
        [
          {
            canonicalRunId: "logged",
            dungeonSlug: "skyreach",
            keyLevel: 14,
            timed: true,
            completedAt: "2026-01-01T00:00:00.000Z",
            durationMs: 1_800_000,
            scoreValue: 400,
            hasWclSource: mythicRunHasWclSource(runWithProvider(provider)),
          },
        ],
        { seasonSlug: "s1", expectedDungeonCount: 8 },
      );
      expect(selection.selectedRuns[0]?.wclReportMatched).toBe(true);
    }
  });

  it("sourceRefHasWcl normalizes provider casing", () => {
    expect(sourceRefHasWcl("WARCRAFT_LOGS")).toBe(true);
    expect(sourceRefHasWcl("warcraft_logs")).toBe(true);
    expect(sourceRefHasWcl("RAIDER_IO")).toBe(false);
  });
});
