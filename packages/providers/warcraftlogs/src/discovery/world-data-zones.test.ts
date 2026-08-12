/**
 * Semantic WCL Mythic+ zone selection from WorldData.
 */
import { describe, expect, it } from "vitest";
import {
  buildMplusCatalogEntryFromZone,
  isMythicPlusZoneName,
  selectActiveMythicPlusZone,
  type WclWorldDataZone,
} from "./world-data-zones.js";

function zone(partial: Partial<WclWorldDataZone> & Pick<WclWorldDataZone, "id" | "name">): WclWorldDataZone {
  return {
    frozen: false,
    encounters: [{ id: 1301, name: "Ara-Kara, City of Echoes" }],
    expansion: { id: 10, name: "The War Within" },
    ...partial,
  };
}

describe("isMythicPlusZoneName", () => {
  it("accepts Keystone / Mythic+ names", () => {
    expect(isMythicPlusZoneName("Midnight Season 2 Keystone")).toBe(true);
    expect(isMythicPlusZoneName("Mythic+ Dungeons")).toBe(true);
    expect(isMythicPlusZoneName("Mythic Plus Season 1")).toBe(true);
  });

  it("rejects raid-only names", () => {
    expect(isMythicPlusZoneName("Nerub-ar Palace")).toBe(false);
    expect(isMythicPlusZoneName("Raid Finder")).toBe(false);
  });
});

describe("selectActiveMythicPlusZone", () => {
  it("selects the single semantic Keystone candidate (not max id)", () => {
    const result = selectActiveMythicPlusZone([
      zone({ id: 9999, name: "Some Future Raid", frozen: false, encounters: [{ id: 1, name: "Boss" }] }),
      zone({ id: 48, name: "Midnight Season 2 Keystone", frozen: false }),
      zone({ id: 47, name: "Midnight Season 1 Keystone", frozen: true }),
    ]);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.zone.id).toBe(48);
    }
  });

  it("returns none when no valid M+ zone exists", () => {
    const result = selectActiveMythicPlusZone([
      zone({ id: 100, name: "Raid Wing", encounters: [{ id: 1, name: "Boss" }] }),
      zone({ id: 101, name: "Keystone Old", frozen: true }),
    ]);
    expect(result).toEqual({ kind: "none" });
  });

  it("returns ambiguous when multiple indistinguishable Keystone zones remain", () => {
    const result = selectActiveMythicPlusZone([
      zone({ id: 48, name: "Midnight Season 2 Keystone" }),
      zone({ id: 49, name: "Another Keystone Season" }),
    ]);
    expect(result.kind).toBe("ambiguous");
    if (result.kind === "ambiguous") {
      expect(result.candidates).toHaveLength(2);
    }
  });

  it("requires non-empty encounters", () => {
    const result = selectActiveMythicPlusZone([
      zone({ id: 48, name: "Midnight Season 2 Keystone", encounters: [] }),
    ]);
    expect(result).toEqual({ kind: "none" });
  });
});

describe("buildMplusCatalogEntryFromZone", () => {
  it("builds ordered dungeon/encounter lists", () => {
    const entry = buildMplusCatalogEntryFromZone(
      zone({
        id: 99,
        name: "Future Keystone Season",
        expansion: { id: 11, name: "Future" },
        encounters: [
          { id: 1301, name: "Ara-Kara, City of Echoes" },
          { id: 999001, name: "Brand New Dungeon" },
        ],
      }),
      99,
    );
    expect(entry.wclZoneId).toBe(99);
    expect(entry.blizzardSeasonId).toBe(99);
    expect(entry.expansionIdentity).toBe("Future");
    expect(entry.encounterIds).toEqual([1301, 999001]);
    expect(entry.dungeonSlugs.length).toBe(2);
    expect(entry.dungeonSlugs[1]).toBe("brand-new-dungeon");
  });
});
