import { describe, expect, it } from "vitest";
import {
  selectSurvivalAnalysisRuns,
  type SurvivalRunCandidateInput,
} from "./survival-run-selection.js";

function run(
  overrides: Partial<SurvivalRunCandidateInput> &
    Pick<SurvivalRunCandidateInput, "dungeonSlug" | "keyLevel">,
): SurvivalRunCandidateInput {
  return {
    canonicalRunId: overrides.canonicalRunId ?? `${overrides.dungeonSlug}-${overrides.keyLevel}`,
    dungeonSlug: overrides.dungeonSlug,
    keyLevel: overrides.keyLevel,
    timed: overrides.timed ?? true,
    completedAt: overrides.completedAt ?? "2026-07-01T12:00:00.000Z",
    durationMs: overrides.durationMs ?? 1_800_000,
    scoreValue: overrides.scoreValue ?? 400,
    hasWclSource: overrides.hasWclSource ?? false,
  };
}

describe("selectSurvivalAnalysisRuns", () => {
  it("selects up to 3 highest runs per allowed dungeon", () => {
    const selection = selectSurvivalAnalysisRuns(
      [
        run({ dungeonSlug: "skyreach", keyLevel: 20, hasWclSource: true, canonicalRunId: "a" }),
        run({ dungeonSlug: "skyreach", keyLevel: 18, hasWclSource: true, canonicalRunId: "b" }),
        run({ dungeonSlug: "skyreach", keyLevel: 16, hasWclSource: true, canonicalRunId: "c" }),
        run({ dungeonSlug: "skyreach", keyLevel: 14, hasWclSource: true, canonicalRunId: "d" }),
        run({ dungeonSlug: "other", keyLevel: 22, hasWclSource: true, canonicalRunId: "x" }),
      ],
      { allowedDungeonSlugs: ["skyreach"], maxRunsPerDungeon: 3 },
    );
    expect(selection.selectedRuns).toHaveLength(3);
    expect(selection.selectedRuns.map((r) => r.canonicalRunId)).toEqual(["a", "b", "c"]);
  });

  it("excludes dungeons not in allowedDungeonSlugs (e.g. Icecrown)", () => {
    const selection = selectSurvivalAnalysisRuns(
      [
        run({ dungeonSlug: "skyreach", keyLevel: 20, hasWclSource: true }),
        run({ dungeonSlug: "icecrown-citadel", keyLevel: 25, hasWclSource: true }),
      ],
      {
        allowedDungeonSlugs: ["skyreach"],
        maxRunsPerDungeon: 3,
      },
    );
    expect(selection.selectedRuns).toHaveLength(1);
    expect(selection.selectedRuns[0]?.dungeonSlug).toBe("skyreach");
  });

  it("prefers next-best with WCL when top lacks WCL", () => {
    const selection = selectSurvivalAnalysisRuns(
      [
        run({
          dungeonSlug: "skyreach",
          keyLevel: 20,
          hasWclSource: false,
          canonicalRunId: "unlogged-top",
        }),
        run({
          dungeonSlug: "skyreach",
          keyLevel: 18,
          hasWclSource: true,
          canonicalRunId: "logged",
        }),
      ],
      { allowedDungeonSlugs: ["skyreach"], maxRunsPerDungeon: 3 },
    );
    expect(selection.selectedRuns[0]?.canonicalRunId).toBe("logged");
    expect(selection.selectedRuns[0]?.selectionReason).toBe(
      "WCL_PREFERRED_OVER_HIGHER_UNLOGGED",
    );
  });

  it("keeps unlogged top when no WCL alternative exists", () => {
    const selection = selectSurvivalAnalysisRuns(
      [
        run({
          dungeonSlug: "skyreach",
          keyLevel: 20,
          hasWclSource: false,
          canonicalRunId: "unlogged",
        }),
      ],
      { allowedDungeonSlugs: ["skyreach"], maxRunsPerDungeon: 3 },
    );
    expect(selection.selectedRuns[0]?.canonicalRunId).toBe("unlogged");
    expect(selection.selectedRuns[0]?.wclReportMatched).toBe(false);
  });
});
