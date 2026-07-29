import { describe, expect, it } from "vitest";
import {
  getAllRegisteredRules,
  resolveAbilityRule,
  WARLOCK_DEMONOLOGY_CATALOG,
} from "./registry.js";
import { rulesForSpell } from "./match.js";

describe("ability source ownership and spell resolution", () => {
  it("player-owned interrupt resolves for warrior pummel (6552)", () => {
    const matches = resolveAbilityRule({ spellId: 6552, classSlug: "warrior", specSlug: "arms" });
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      canonicalKey: "warrior.interrupt.pummel",
      sourceOwnership: "PLAYER",
      category: "INTERRUPT",
    });
  });

  it("pet interrupt resolves for warlock spell lock (19647) with PET ownership", () => {
    const matches = resolveAbilityRule({
      spellId: 19647,
      classSlug: "warlock",
      specSlug: "demonology",
    });
    expect(matches.some((r) => r.canonicalKey === "warlock.interrupt.spell-lock")).toBe(true);
    const spellLock = matches.find((r) => r.canonicalKey === "warlock.interrupt.spell-lock");
    expect(spellLock).toMatchObject({
      sourceOwnership: "PET",
      availability: "PET_DEPENDENT",
      category: "INTERRUPT",
    });
  });

  it("healthstone alias 5512 resolves to shared consumable rule", () => {
    const byAlias = resolveAbilityRule({ spellId: 5512 });
    const byPrimary = resolveAbilityRule({ spellId: 6262 });

    expect(byAlias.some((r) => r.canonicalKey === "shared.consumable.healthstone")).toBe(true);
    expect(byPrimary.some((r) => r.canonicalKey === "shared.consumable.healthstone")).toBe(true);

    const catalogMatches = rulesForSpell(WARLOCK_DEMONOLOGY_CATALOG, 5512);
    expect(catalogMatches.some((r) => r.canonicalKey === "shared.consumable.healthstone")).toBe(
      true,
    );
  });

  // No catalog rule currently uses sourceOwnership GUARDIAN (guardian-spirit is PLAYER external defensive).
  it.skip("guardian-owned abilities — skipped until a GUARDIAN rule exists in the catalog", () => {
    const guardianRules = getAllRegisteredRules().filter((r) => r.sourceOwnership === "GUARDIAN");
    expect(guardianRules.length).toBeGreaterThan(0);
  });

  it("class filter excludes cross-class spell collisions on resolveAbilityRule", () => {
    const warriorOnly = resolveAbilityRule({ spellId: 6552, classSlug: "warrior" });
    const warlockFiltered = resolveAbilityRule({ spellId: 6552, classSlug: "warlock" });
    expect(warriorOnly.length).toBeGreaterThan(0);
    expect(warlockFiltered).toHaveLength(0);
  });
});
