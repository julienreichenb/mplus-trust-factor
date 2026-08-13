import { describe, expect, it } from "vitest";
import {
  UTILITY_V2_FAMILY_KEYS,
  emptyFamilyApplicability,
  legacyToolkitBooleansFromFamilies,
  utilityFamilyFromCatalogCategory,
  utilityFamilyFromDigestCategory,
} from "./families.js";
import { resolveUtilityToolkitFromCatalog } from "./toolkit.js";

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

describe("legacyToolkitBooleansFromFamilies", () => {
  it("does not claim a toolkit when every family is uncertain", () => {
    const families = emptyFamilyApplicability("uncertain", "class_spec_identity_unknown");
    expect(legacyToolkitBooleansFromFamilies(families)).toEqual({
      hasInterrupt: false,
      hasSupport: false,
      hasStrategicCc: false,
    });
  });

  it("claims flags only for confirmed applicable or optional families", () => {
    const families = emptyFamilyApplicability("not_applicable");
    families.interrupt = { state: "applicable", reason: "baseline" };
    families.crowdControl = { state: "uncertain", reason: "talent_data_unavailable" };
    families.bloodlust = { state: "optional", reason: "optional_group_expectation" };
    expect(legacyToolkitBooleansFromFamilies(families)).toEqual({
      hasInterrupt: true,
      hasSupport: true,
      hasStrategicCc: false,
    });
  });
});

describe("unknown class/spec toolkit", () => {
  it("does not fabricate confirmed flags or unused-family applicability", () => {
    const resolved = resolveUtilityToolkitFromCatalog({
      classSlug: null,
      specSlug: null,
      observedFamilies: {
        interrupt: true,
        crowdControl: true,
        groupSupport: true,
      },
    });
    expect(resolved.catalogSupported).toBe(false);
    expect(resolved.toolkit.hasInterrupt).toBe(false);
    expect(resolved.toolkit.hasSupport).toBe(false);
    expect(resolved.toolkit.hasStrategicCc).toBe(false);
    expect(resolved.limitations).toContain("class_spec_identity_unknown");
    expect(resolved.limitations).toContain("toolkit_coverage_unconfirmed");
    for (const key of UTILITY_V2_FAMILY_KEYS) {
      expect(resolved.toolkit.families?.[key].state).toBe("uncertain");
    }
  });
});
