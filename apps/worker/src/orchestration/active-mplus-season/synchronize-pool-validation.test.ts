import { describe, expect, it } from "vitest";
import { validateCatalogDungeonPool } from "./synchronize.js";

describe("validateCatalogDungeonPool", () => {
  it("rejects exact duplicate dungeon slugs before persistence", () => {
    expect(() =>
      validateCatalogDungeonPool({
        wclZoneId: 55,
        blizzardSeasonId: 18,
        expansionIdentity: "Midnight",
        displayName: "Midnight Season 2",
        dungeonSlugs: ["skyreach", "skyreach"],
        encounterIds: [1, 1],
      }),
    ).toThrow(/duplicate dungeon slugs: skyreach/);
  });

  it("rejects aliases that canonicalize to the same dungeon", () => {
    expect(() =>
      validateCatalogDungeonPool({
        wclZoneId: 55,
        blizzardSeasonId: 18,
        expansionIdentity: "Midnight",
        displayName: "Midnight Season 2",
        dungeonSlugs: ["Nexus Point Xenas", "nexus-point-xenas"],
        encounterIds: [1, 1],
      }),
    ).toThrow(/duplicate dungeon slugs: nexus-point-xenas/);
  });

  it("keeps a valid ordered pool", () => {
    const result = validateCatalogDungeonPool({
      wclZoneId: 55,
      blizzardSeasonId: 18,
      expansionIdentity: "Midnight",
      displayName: "Midnight Season 2",
      dungeonSlugs: ["Skyreach", "Pit of Saron"],
      encounterIds: [1, 2],
    });

    expect(result.dungeonSlugs).toEqual(["skyreach", "pit-of-saron"]);
  });
});
