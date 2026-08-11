/**
 * resolveDungeonSlug / slugifyDungeonName — generic dungeon slug helpers.
 */
import { describe, expect, it } from "vitest";
import { slugifyDungeonName } from "./dungeon-slug.js";
import { resolveDungeonSlug } from "./report-fight-mapping.js";

describe("slugifyDungeonName", () => {
  it("slugifies possessive dungeon names", () => {
    expect(slugifyDungeonName("Maisara's Caverns")).toBe("maisara-caverns");
  });
});

describe("resolveDungeonSlug", () => {
  it("prefers fight.name when report.zone.name is the generic Mythic+ container", () => {
    const slug = resolveDungeonSlug(
      {
        id: 1,
        encounterID: 0,
        name: "Skyreach",
        keystoneLevel: 12,
        keystoneBonus: 1,
        startTime: 0,
        endTime: 1000,
        friendlyPlayers: [1],
      },
      "Mythic+",
    );
    expect(slug).toBe("skyreach");
    expect(slug).not.toBe("mythic");
  });

  it("uses report zone name when it is a specific dungeon name", () => {
    const slug = resolveDungeonSlug(
      {
        id: 1,
        encounterID: 0,
        name: "Overgrown Ancient",
        keystoneLevel: 12,
        keystoneBonus: 1,
        startTime: 0,
        endTime: 1000,
        friendlyPlayers: [1],
      },
      "Algeth'ar Academy",
    );
    expect(slug).toBe("algethar-academy");
  });

  it("maps known encounter IDs before name slugification", () => {
    const slug = resolveDungeonSlug(
      {
        id: 1,
        encounterID: 61_209,
        name: "Some Boss",
        keystoneLevel: 12,
        keystoneBonus: 1,
        startTime: 0,
        endTime: 1000,
        friendlyPlayers: [1],
      },
      "Mythic+",
    );
    expect(slug).toBe("skyreach");
  });
});
