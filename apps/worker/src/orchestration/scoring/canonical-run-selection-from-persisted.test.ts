import { describe, expect, it } from "vitest";
import { selectCanonicalRunsFromPersistedMythicRuns } from "./canonical-run-selection-from-persisted.js";

const DUNGEONS = [
  "ara-kara-city-of-echoes",
  "city-of-threads",
  "the-dawnbreaker",
  "the-stonevault",
  "mists-of-tirna-scithe",
  "the-necrotic-wake",
  "siege-of-boralus",
  "grim-batol",
];

describe("selectCanonicalRunsFromPersistedMythicRuns", () => {
  it("rebuilds the same 8 dungeon representatives from persisted MythicRuns", () => {
    const persisted = DUNGEONS.flatMap((slug, i) => [
      {
        id: `low-${i}`,
        keyLevel: 10,
        timed: true,
        completedAt: new Date("2026-01-01T00:00:00.000Z"),
        durationMs: 1000,
        scoreValue: 100,
        dungeon: { slug },
        sources: [{ provider: "WARCRAFT_LOGS" }],
      },
      {
        id: `win-${i}`,
        keyLevel: 18 + (i % 3),
        timed: true,
        completedAt: new Date("2026-01-02T00:00:00.000Z"),
        durationMs: 1000,
        scoreValue: 200,
        dungeon: { slug },
        sources: [{ provider: "WARCRAFT_LOGS" }],
      },
    ]);

    const selection = selectCanonicalRunsFromPersistedMythicRuns({
      seasonSlug: "midnight-season-1",
      expectedDungeonCount: 8,
      allowedDungeonSlugs: DUNGEONS,
      persistedRuns: persisted,
    });

    expect(selection.selectedRuns).toHaveLength(8);
    expect(selection.selectedRuns.map((r) => r.canonicalRunId).sort()).toEqual(
      DUNGEONS.map((_, i) => `win-${i}`).sort(),
    );
    expect(selection.selectedRuns.every((r) => r.keyLevel >= 18)).toBe(true);
  });

  it("does not fabricate runs when persisted coverage is incomplete", () => {
    const selection = selectCanonicalRunsFromPersistedMythicRuns({
      seasonSlug: "midnight-season-1",
      expectedDungeonCount: 8,
      allowedDungeonSlugs: DUNGEONS,
      persistedRuns: [
        {
          id: "only-one",
          keyLevel: 20,
          timed: true,
          completedAt: new Date("2026-01-01T00:00:00.000Z"),
          durationMs: 1000,
          scoreValue: 200,
          dungeon: { slug: DUNGEONS[0]! },
          sources: [{ provider: "RAIDER_IO" }],
        },
      ],
    });
    expect(selection.selectedRuns).toHaveLength(1);
    expect(selection.expectedDungeonCount).toBe(8);
  });
});
