import { describe, expect, it } from "vitest";
import type { BlizzardCharacterAchievementsDTO } from "@mplus/contracts";
import {
  ELITE_CUTOFF_CATALOG_V1,
  extractEliteCutoffHistory,
  getEliteCutoffCatalogEntry,
} from "./elite-cutoff-history.js";

/** Unrelated Keystone Hero rating milestone (TWW S1 Hero 2500) — not 0.1%. */
const KEYSTONE_HERO_TWW_S1 = 20_526;
/** Unrelated PvP Elite rank FoS — not Mythic+ 0.1%. */
const PVP_ELITE_DF_S3 = 19_090;

const TEMPERED = 20_589;
const ENTERPRISING = 40_954;
const DREAMING = 19_449;
const THUNDERING = 16_429;

function dto(
  rows: Array<{ achievementId: number; completedAt: string | null }>,
): BlizzardCharacterAchievementsDTO {
  return { achievements: rows };
}

describe("ELITE_CUTOFF_CATALOG_V1", () => {
  it("contains only topPercent 0.1 entries with unique IDs", () => {
    const ids = ELITE_CUTOFF_CATALOG_V1.map((e) => e.achievementId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of ELITE_CUTOFF_CATALOG_V1) {
      expect(entry.topPercent).toBe(0.1);
      expect(entry.achievementId).toBeGreaterThan(0);
      expect(entry.seasonSlug.length).toBeGreaterThan(0);
      expect(entry.title.length).toBeGreaterThan(0);
    }
  });

  it("does not include known Keystone Hero / Master milestone IDs", () => {
    expect(getEliteCutoffCatalogEntry(KEYSTONE_HERO_TWW_S1)).toBeNull();
    expect(getEliteCutoffCatalogEntry(20_525)).toBeNull(); // TWW KSM S1
    expect(getEliteCutoffCatalogEntry(19_012)).toBeNull(); // DF KSH S3
  });
});

describe("extractEliteCutoffHistory", () => {
  it("matches a genuine catalog achievement", () => {
    const result = extractEliteCutoffHistory(
      dto([{ achievementId: TEMPERED, completedAt: "2025-03-01T12:00:00.000Z" }]),
    );
    expect(result.confirmedCount).toBe(1);
    expect(result.confirmed[0]).toEqual({
      achievementId: TEMPERED,
      seasonSlug: "season-tww-1",
      title: "Tempered Hero: The War Within Season 1",
      completedAt: "2025-03-01T12:00:00.000Z",
    });
  });

  it("ignores unrelated Keystone Hero achievements", () => {
    const result = extractEliteCutoffHistory(
      dto([
        { achievementId: KEYSTONE_HERO_TWW_S1, completedAt: "2025-01-01T00:00:00.000Z" },
        { achievementId: TEMPERED, completedAt: "2025-03-01T00:00:00.000Z" },
      ]),
    );
    expect(result.confirmedCount).toBe(1);
    expect(result.confirmed[0]!.achievementId).toBe(TEMPERED);
  });

  it("ignores PvP Elite achievements", () => {
    const result = extractEliteCutoffHistory(
      dto([{ achievementId: PVP_ELITE_DF_S3, completedAt: "2024-01-01T00:00:00.000Z" }]),
    );
    expect(result.confirmedCount).toBe(0);
    expect(result.confirmed).toEqual([]);
  });

  it("retains multiple historical titles", () => {
    const result = extractEliteCutoffHistory(
      dto([
        { achievementId: ENTERPRISING, completedAt: "2025-08-01T00:00:00.000Z" },
        { achievementId: DREAMING, completedAt: "2024-04-01T00:00:00.000Z" },
        { achievementId: THUNDERING, completedAt: "2023-05-01T00:00:00.000Z" },
      ]),
    );
    expect(result.confirmedCount).toBe(3);
    expect(result.confirmed.map((c) => c.achievementId)).toEqual([
      THUNDERING,
      DREAMING,
      ENTERPRISING,
    ]);
  });

  it("deduplicates duplicate Blizzard achievement IDs", () => {
    const result = extractEliteCutoffHistory(
      dto([
        { achievementId: TEMPERED, completedAt: null },
        { achievementId: TEMPERED, completedAt: "2025-03-01T00:00:00.000Z" },
        { achievementId: TEMPERED, completedAt: "2025-03-01T00:00:00.000Z" },
      ]),
    );
    expect(result.confirmedCount).toBe(1);
    expect(result.confirmed[0]!.completedAt).toBe("2025-03-01T00:00:00.000Z");
  });

  it("preserves completion timestamps", () => {
    const ts = "2024-04-22T18:30:00.000Z";
    const result = extractEliteCutoffHistory(dto([{ achievementId: DREAMING, completedAt: ts }]));
    expect(result.confirmed[0]!.completedAt).toBe(ts);
  });

  it("treats old and recent confirmations as equal evidence (no age decay)", () => {
    const oldOnly = extractEliteCutoffHistory(
      dto([{ achievementId: THUNDERING, completedAt: "2023-05-01T00:00:00.000Z" }]),
    );
    const recentOnly = extractEliteCutoffHistory(
      dto([{ achievementId: ENTERPRISING, completedAt: "2025-08-01T00:00:00.000Z" }]),
    );
    expect(oldOnly.confirmedCount).toBe(1);
    expect(recentOnly.confirmedCount).toBe(1);
    // Evidence shape is identical aside from catalog fields — no seasonsAgo / weight fields.
    expect(Object.keys(oldOnly.confirmed[0]!).sort()).toEqual(
      Object.keys(recentOnly.confirmed[0]!).sort(),
    );
    expect(oldOnly.confirmed[0]).not.toHaveProperty("seasonsAgo");
    expect(recentOnly.confirmed[0]).not.toHaveProperty("ageFactor");
  });

  it("orders confirmed titles deterministically by seasonSlug then achievementId", () => {
    const a = extractEliteCutoffHistory(
      dto([
        { achievementId: ENTERPRISING, completedAt: null },
        { achievementId: THUNDERING, completedAt: null },
        { achievementId: TEMPERED, completedAt: null },
        { achievementId: DREAMING, completedAt: null },
      ]),
    );
    const b = extractEliteCutoffHistory(
      dto([
        { achievementId: DREAMING, completedAt: null },
        { achievementId: TEMPERED, completedAt: null },
        { achievementId: THUNDERING, completedAt: null },
        { achievementId: ENTERPRISING, completedAt: null },
      ]),
    );
    expect(a).toEqual(b);
    expect(a.confirmed.map((c) => c.seasonSlug)).toEqual([
      "season-df-1",
      "season-df-3",
      "season-tww-1",
      "season-tww-2",
    ]);
  });
});
