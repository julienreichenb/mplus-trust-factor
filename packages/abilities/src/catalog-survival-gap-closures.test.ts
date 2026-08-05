/**
 * Survival catalog closures from spike fight 1WKcCz2BnAQmbhfq:1:r1.
 *
 * Confirmed via Wowhead + legacy unfiltered Casts/Buffs observation:
 * - 444741 Anti-Magic Shell absorb/pet aura → triggeredEffectIds on AMS (not activation-opening)
 * - 452930 Demonic Healthstone → alias of shared.consumable.healthstone (heal-use)
 * - 1234768 Silvermoon Health Potion → shared.consumable.healing-potion spellId
 *
 * Not integrated as Survival recovery:
 * - 6201 Create Healthstone is the warlock craft cast, not a heal-use activation.
 */
import { describe, expect, it } from "vitest";
import {
  dimensionTagsForRule,
  getAllRegisteredRules,
  rulesForSpell,
  getAbilityCatalog,
} from "./index.js";

function ruleByKey(key: string) {
  const rule = getAllRegisteredRules().find((r) => r.canonicalKey === key);
  expect(rule, key).toBeTruthy();
  return rule!;
}

describe("proven survival catalog gap closures (1WKcCz2BnAQmbhfq:1)", () => {
  it("maps AMS aura/cast 444741 to anti-magic-shell", () => {
    const catalog = getAbilityCatalog({ classSlug: "death-knight", specSlug: "unholy" });
    const matched = rulesForSpell(catalog, 444741);
    expect(matched.some((r) => r.canonicalKey === "death-knight.defensive-major.anti-magic-shell")).toBe(
      true,
    );
    const ams = ruleByKey("death-knight.defensive-major.anti-magic-shell");
    expect(ams.spellIds).toEqual([48707]);
    expect(ams.triggeredEffectIds).toEqual(expect.arrayContaining([444741]));
    expect(ams.aliases ?? []).not.toContain(444741);
    expect(ams.activationEventTypes).toEqual(["cast"]);
    expect(dimensionTagsForRule(ams)).toContain("SURVIVAL_PERSONAL_DEFENSIVE");
  });

  it("maps Demonic Healthstone 452930 to shared healthstone consumable", () => {
    const matched = rulesForSpell(getAbilityCatalog({ classSlug: null }), 452930);
    expect(matched.some((r) => r.canonicalKey === "shared.consumable.healthstone")).toBe(true);
    expect(ruleByKey("shared.consumable.healthstone").aliases).toEqual(
      expect.arrayContaining([5512, 452930]),
    );
  });

  it("maps Silvermoon Health Potion 1234768 to shared healing potion", () => {
    const matched = rulesForSpell(getAbilityCatalog({ classSlug: null }), 1234768);
    expect(matched.some((r) => r.canonicalKey === "shared.consumable.healing-potion")).toBe(true);
    expect(ruleByKey("shared.consumable.healing-potion").spellIds).toEqual(
      expect.arrayContaining([1234768]),
    );
  });

  it("does not treat Create Healthstone 6201 as a recovery consumable", () => {
    const matched = rulesForSpell(getAbilityCatalog({ classSlug: null }), 6201);
    expect(matched.some((r) => r.category === "CONSUMABLE" || r.category === "SELF_HEAL")).toBe(
      false,
    );
  });
});
