import { describe, expect, it } from "vitest";
import { getAbilityCatalog } from "./registry.js";
import { rulesForCategory } from "./match.js";

function expectCatalog(classSlug: string, specSlug: string, role: "DPS" | "TANK" | "HEALER") {
  const catalog = getAbilityCatalog({ classSlug, specSlug, role, includeShared: false });
  expect(catalog.supported, `${classSlug}/${specSlug}`).toBe(true);
  return catalog;
}

describe("cross-class fixture archetypes", () => {
  it("melee DPS: warrior/arms has INTERRUPT (Pummel)", () => {
    const catalog = expectCatalog("warrior", "arms", "DPS");
    const interrupts = rulesForCategory(catalog, "INTERRUPT", {
      classSlug: "warrior",
      specSlug: "arms",
    });
    expect(interrupts.some((r) => r.canonicalKey === "warrior.interrupt.pummel")).toBe(true);
    expect(interrupts.every((r) => r.sourceOwnership === "PLAYER")).toBe(true);
  });

  it("ranged DPS: mage/fire has INTERRUPT (Counterspell)", () => {
    const catalog = expectCatalog("mage", "fire", "DPS");
    const interrupts = rulesForCategory(catalog, "INTERRUPT", {
      classSlug: "mage",
      specSlug: "fire",
    });
    expect(interrupts.some((r) => r.canonicalKey === "mage.interrupt.counterspell")).toBe(true);
  });

  it("tank: death-knight/blood has DEFENSIVE_MAJOR (Vampiric Blood)", () => {
    const catalog = expectCatalog("death-knight", "blood", "TANK");
    const defensives = rulesForCategory(catalog, "DEFENSIVE_MAJOR", {
      classSlug: "death-knight",
      specSlug: "blood",
    });
    expect(
      defensives.some((r) => r.canonicalKey === "death-knight.defensive-major.vampiric-blood"),
    ).toBe(true);
  });

  it("healer: priest/holy has DISPEL (Purify)", () => {
    const catalog = expectCatalog("priest", "holy", "HEALER");
    const dispels = rulesForCategory(catalog, "DISPEL", {
      classSlug: "priest",
      specSlug: "holy",
    });
    expect(dispels.some((r) => r.canonicalKey === "priest.dispel.purify")).toBe(true);
  });

  it("pet-based: warlock/demonology interrupt uses PET ownership", () => {
    const catalog = expectCatalog("warlock", "demonology", "DPS");
    const interrupts = rulesForCategory(catalog, "INTERRUPT", {
      classSlug: "warlock",
      specSlug: "demonology",
    });
    expect(interrupts.some((r) => r.sourceOwnership === "PET")).toBe(true);
    expect(interrupts.some((r) => r.canonicalKey === "warlock.interrupt.spell-lock")).toBe(true);
  });

  it("multi-spec shared: warlock Shadowfury spans all specs via explicit spec list", () => {
    for (const spec of ["affliction", "demonology", "destruction"] as const) {
      const catalog = expectCatalog("warlock", spec, "DPS");
      const shadowfury = rulesForCategory(catalog, "HARD_CC", {
        classSlug: "warlock",
        specSlug: spec,
      }).find((r) => r.canonicalKey === "warlock.hard-cc.shadowfury");
      expect(shadowfury, spec).toBeDefined();
      expect(shadowfury!.sharedAcrossSpecs).toBe(false);
      expect(shadowfury!.specSlugs).toEqual(["affliction", "demonology", "destruction"]);
    }
  });

  it("class-wide shared: warlock Fear has empty specSlugs (all specs)", () => {
    const catalog = expectCatalog("warlock", "destruction", "DPS");
    const fear = catalog.rules.find((r) => r.canonicalKey === "warlock.soft-cc.fear");
    expect(fear).toBeDefined();
    expect(fear!.specSlugs).toEqual([]);
    expect(fear!.sharedAcrossSpecs).toBe(true);
  });
});
