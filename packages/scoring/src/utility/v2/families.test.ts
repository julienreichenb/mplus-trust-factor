import { describe, expect, it } from "vitest";
import {
  utilityFamilyFromCatalogCategory,
  utilityFamilyFromDigestCategory,
} from "./families.js";

describe("utility family mapping", () => {
  it("maps catalog categories to scoring families without spell IDs", () => {
    expect(utilityFamilyFromCatalogCategory("INTERRUPT")).toBe("interrupt");
    expect(utilityFamilyFromCatalogCategory("HARD_CC")).toBe("crowdControl");
    expect(utilityFamilyFromCatalogCategory("SOFT_CC")).toBe("crowdControl");
    expect(utilityFamilyFromCatalogCategory("DISPEL")).toBe("dispelPurge");
    expect(utilityFamilyFromCatalogCategory("PURGE")).toBe("dispelPurge");
    expect(utilityFamilyFromCatalogCategory("EXTERNAL_DEFENSIVE")).toBe("groupSupport");
    expect(utilityFamilyFromCatalogCategory("GROUP_UTILITY")).toBe("groupSupport");
    expect(utilityFamilyFromCatalogCategory("MOVEMENT_UTILITY")).toBe("movement");
    expect(utilityFamilyFromCatalogCategory("BATTLE_REZ")).toBe("combatRes");
    expect(utilityFamilyFromCatalogCategory("BLOODLUST")).toBe("bloodlust");
    expect(utilityFamilyFromCatalogCategory("DEFENSIVE_MAJOR")).toBeNull();
  });

  it("maps digest utility categories to the same families", () => {
    expect(utilityFamilyFromDigestCategory("INTERRUPT")).toBe("interrupt");
    expect(utilityFamilyFromDigestCategory("STOP")).toBe("crowdControl");
    expect(utilityFamilyFromDigestCategory("CROWD_CONTROL")).toBe("crowdControl");
    expect(utilityFamilyFromDigestCategory("OFFENSIVE_DISPEL")).toBe("dispelPurge");
    expect(utilityFamilyFromDigestCategory("DEFENSIVE_DISPEL")).toBe("dispelPurge");
    expect(utilityFamilyFromDigestCategory("COMBAT_RES")).toBe("combatRes");
    expect(utilityFamilyFromDigestCategory("EXTERNAL_SUPPORT")).toBe("groupSupport");
    expect(utilityFamilyFromDigestCategory("OTHER_UTILITY")).toBe("movement");
  });
});
