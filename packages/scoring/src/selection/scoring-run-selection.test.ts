import { describe, expect, it } from "vitest";
import { selectScoringRuns, type ScoringRunCandidateInput } from "./scoring-run-selection.js";

function run(overrides: Partial<ScoringRunCandidateInput> & Pick<ScoringRunCandidateInput, "dungeonSlug" | "keyLevel">): ScoringRunCandidateInput {
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

describe("selectScoringRuns", () => {
  it("selects eight unique dungeons with highest key per dungeon", () => {
    const dungeons = [
      "ara-kara-city-of-echoes",
      "eco-dome-al'dani",
      "halls-of-atonement",
      "operation-floodgate",
      "priory-of-the-sacred-flame",
      "tazavesh-streets-of-wonder",
      "the-dawnbreaker",
      "the-rookery",
    ];
    const runs = dungeons.flatMap((dungeonSlug, i) => [
      run({ dungeonSlug, keyLevel: 10 + i, canonicalRunId: `${dungeonSlug}-low` }),
      run({ dungeonSlug, keyLevel: 15 + i, canonicalRunId: `${dungeonSlug}-high`, hasWclSource: true }),
    ]);
    const selection = selectScoringRuns(runs, { seasonSlug: "s1", expectedDungeonCount: 8 });
    expect(selection.selectedRuns).toHaveLength(8);
    expect(new Set(selection.selectedRuns.map((r) => r.dungeonSlug)).size).toBe(8);
    for (const entry of selection.selectedRuns) {
      expect(entry.keyLevel).toBeGreaterThanOrEqual(15);
      expect(entry.selectionReason).toBe("HIGHEST_KEY");
    }
  });

  it("falls back to logged run when highest candidate has no WCL", () => {
    const selection = selectScoringRuns(
      [
        run({ dungeonSlug: "skyreach", keyLevel: 14, hasWclSource: true, canonicalRunId: "logged" }),
        run({ dungeonSlug: "skyreach", keyLevel: 16, hasWclSource: false, canonicalRunId: "unlogged" }),
      ],
      { seasonSlug: "s1", expectedDungeonCount: 8 },
    );
    expect(selection.selectedRuns[0]?.canonicalRunId).toBe("logged");
    expect(selection.selectedRuns[0]?.wclReportMatched).toBe(true);
    expect(selection.selectedRuns[0]?.selectionReason).toBe("WCL_PREFERRED_OVER_HIGHER_UNLOGGED");
  });

  it("selects the highest-key logged run among multiple unlogged before it", () => {
    const selection = selectScoringRuns(
      [
        run({ dungeonSlug: "skyreach", keyLevel: 20, hasWclSource: false, canonicalRunId: "u1" }),
        run({ dungeonSlug: "skyreach", keyLevel: 18, hasWclSource: false, canonicalRunId: "u2" }),
        run({ dungeonSlug: "skyreach", keyLevel: 16, hasWclSource: true, canonicalRunId: "logged" }),
      ],
      { seasonSlug: "s1", expectedDungeonCount: 8 },
    );
    expect(selection.selectedRuns[0]?.canonicalRunId).toBe("logged");
    expect(selection.selectedRuns[0]?.wclReportMatched).toBe(true);
  });

  it("keeps unlogged when no candidate has WCL", () => {
    const selection = selectScoringRuns(
      [
        run({ dungeonSlug: "skyreach", keyLevel: 16, hasWclSource: false, canonicalRunId: "unlogged" }),
        run({ dungeonSlug: "skyreach", keyLevel: 14, hasWclSource: false, canonicalRunId: "unlogged2" }),
      ],
      { seasonSlug: "s1", expectedDungeonCount: 8 },
    );
    expect(selection.selectedRuns[0]?.canonicalRunId).toBe("unlogged");
    expect(selection.selectedRuns[0]?.wclReportMatched).toBe(false);
  });

  it("tie-breaks equal keys by score then latest", () => {
    const selection = selectScoringRuns(
      [
        run({
          dungeonSlug: "skyreach",
          keyLevel: 12,
          scoreValue: 380,
          completedAt: "2026-06-01T12:00:00.000Z",
          canonicalRunId: "older",
        }),
        run({
          dungeonSlug: "skyreach",
          keyLevel: 12,
          scoreValue: 420,
          completedAt: "2026-07-01T12:00:00.000Z",
          canonicalRunId: "higher-score",
        }),
      ],
      { seasonSlug: "s1", expectedDungeonCount: 8 },
    );
    expect(selection.selectedRuns[0]?.canonicalRunId).toBe("higher-score");
    expect(selection.selectedRuns[0]?.selectionReason).toBe("HIGHEST_SCORE_TIEBREAK");
  });
});
