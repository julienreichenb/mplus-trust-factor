import { describe, expect, it } from "vitest";
import { resolveActiveSeasonDungeonSlugs } from "./active-season-dungeons.js";
import { selectScoringRuns } from "./scoring-run-selection.js";

const ACTIVE_EIGHT = [
  "algethar-academy",
  "magisters-terrace",
  "maisara-caverns",
  "nexus-point-xenas",
  "pit-of-saron",
  "seat-of-the-triumvirate",
  "skyreach",
  "windrunner-spire",
];

describe("active-season dungeon pool", () => {
  it("prefers WCL aggregate slugs when the pool is complete", () => {
    const slugs = resolveActiveSeasonDungeonSlugs({
      expectedDungeonCount: 8,
      wclDungeonSlugs: ACTIVE_EIGHT,
      seasonDungeonSlugs: ["icecrown"],
    });
    expect(slugs).toEqual(ACTIVE_EIGHT);
    expect(slugs).not.toContain("icecrown");
  });

  it("excludes off-pool dungeons from scoring selection", () => {
    const runs = [
      ...ACTIVE_EIGHT.map((dungeonSlug, i) => ({
        canonicalRunId: `${dungeonSlug}-run`,
        dungeonSlug,
        keyLevel: 10 + i,
        timed: true,
        completedAt: "2026-07-01T12:00:00.000Z",
        durationMs: 1_800_000,
        scoreValue: 400,
        hasWclSource: false,
      })),
      {
        canonicalRunId: "icecrown-run",
        dungeonSlug: "icecrown",
        keyLevel: 20,
        timed: true,
        completedAt: "2026-07-02T12:00:00.000Z",
        durationMs: 1_800_000,
        scoreValue: 500,
        hasWclSource: true,
      },
    ];

    const selection = selectScoringRuns(runs, {
      seasonSlug: "s1",
      expectedDungeonCount: 8,
      allowedDungeonSlugs: ACTIVE_EIGHT,
    });

    expect(selection.selectedRuns).toHaveLength(8);
    expect(selection.expectedDungeonCount).toBe(8);
    expect(new Set(selection.selectedRuns.map((r) => r.dungeonSlug)).size).toBe(8);
    expect(selection.selectedRuns.some((r) => r.dungeonSlug === "icecrown")).toBe(false);
  });
});
