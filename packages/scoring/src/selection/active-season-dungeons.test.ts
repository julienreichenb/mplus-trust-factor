import { describe, expect, it } from "vitest";
import {
  resolveActiveSeasonDungeonPool,
  resolveActiveSeasonDungeonSlugs,
} from "./active-season-dungeons.js";
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

function runCandidate(
  dungeonSlug: string,
  overrides: Partial<{
    canonicalRunId: string;
    keyLevel: number;
    hasWclSource: boolean;
    completedAt: string;
  }> = {},
) {
  return {
    canonicalRunId: overrides.canonicalRunId ?? `${dungeonSlug}-run`,
    dungeonSlug,
    keyLevel: overrides.keyLevel ?? 12,
    timed: true,
    completedAt: overrides.completedAt ?? "2026-07-01T12:00:00.000Z",
    durationMs: 1_800_000,
    scoreValue: 400,
    hasWclSource: overrides.hasWclSource ?? false,
  };
}

describe("active-season dungeon pool", () => {
  it("uses season DB slugs exclusively; WCL cannot define or expand the pool", () => {
    const pool = resolveActiveSeasonDungeonPool({
      expectedDungeonCount: 8,
      wclDungeonSlugs: [...ACTIVE_EIGHT, "icecrown"],
      seasonDungeonSlugs: ACTIVE_EIGHT,
    });
    expect(pool.canonicalSlugs).toEqual(ACTIVE_EIGHT);
    expect(pool.source).toBe("season_db");
    expect(pool.wclOffPoolSlugs).toEqual(["icecrown"]);
    expect(pool.wclMatchedSlugs).toEqual(ACTIVE_EIGHT);
  });

  it("prefers season DB over Blizzard metadata and Raider.IO static data", () => {
    const slugs = resolveActiveSeasonDungeonSlugs({
      expectedDungeonCount: 8,
      seasonDungeonSlugs: ACTIVE_EIGHT,
      blizzardSeasonDungeonSlugs: ["icecrown"],
      raiderioDungeonSlugs: ["icecrown", "skyreach"],
      wclDungeonSlugs: ["icecrown"],
    });
    expect(slugs).toEqual(ACTIVE_EIGHT);
    expect(slugs).not.toContain("icecrown");
  });

  it("excludes icecrown when WCL is partial and season metadata is authoritative", () => {
    const pool = resolveActiveSeasonDungeonPool({
      expectedDungeonCount: 8,
      seasonDungeonSlugs: ACTIVE_EIGHT,
      wclDungeonSlugs: ["pit-of-saron", "icecrown", "skyreach"],
    });
    expect(pool.canonicalSlugs).toEqual(ACTIVE_EIGHT);
    expect(pool.wclMatchedSlugs).toEqual(["pit-of-saron", "skyreach"]);
    expect(pool.wclOffPoolSlugs).toEqual(["icecrown"]);

    const runs = [
      ...ACTIVE_EIGHT.map((dungeonSlug, index) =>
        runCandidate(dungeonSlug, { keyLevel: 10 + index }),
      ),
      runCandidate("icecrown", { keyLevel: 20, hasWclSource: true }),
    ];

    const selection = selectScoringRuns(runs, {
      seasonSlug: "s1",
      expectedDungeonCount: 8,
      allowedDungeonSlugs: pool.canonicalSlugs,
    });

    expect(selection.selectedRuns).toHaveLength(8);
    expect(selection.selectedRuns.some((r) => r.dungeonSlug === "icecrown")).toBe(false);
  });

  it("excludes icecrown when WCL is unavailable and character history includes off-pool runs", () => {
    const pool = resolveActiveSeasonDungeonPool({
      expectedDungeonCount: 8,
      seasonDungeonSlugs: ACTIVE_EIGHT,
      wclDungeonSlugs: [],
    });
    expect(pool.source).toBe("season_db");
    expect(pool.wclMatchedSlugs).toEqual([]);
    expect(pool.wclOffPoolSlugs).toEqual([]);

    const runs = [
      ...ACTIVE_EIGHT.map((dungeonSlug) => runCandidate(dungeonSlug)),
      runCandidate("icecrown", {
        keyLevel: 18,
        hasWclSource: false,
        completedAt: "2026-07-15T12:00:00.000Z",
      }),
    ];

    const selection = selectScoringRuns(runs, {
      seasonSlug: "s1",
      expectedDungeonCount: 8,
      allowedDungeonSlugs: pool.canonicalSlugs,
    });

    expect(selection.selectedRuns).toHaveLength(8);
    expect(new Set(selection.selectedRuns.map((r) => r.dungeonSlug)).size).toBe(8);
    expect(selection.selectedRuns.some((r) => r.dungeonSlug === "icecrown")).toBe(false);
  });

  it("excludes off-pool dungeons from scoring selection", () => {
    const runs = [
      ...ACTIVE_EIGHT.map((dungeonSlug, i) =>
        runCandidate(dungeonSlug, { keyLevel: 10 + i }),
      ),
      runCandidate("icecrown", { keyLevel: 20, hasWclSource: true }),
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
