/**
 * Regression: proven Utility catalog gaps from spike fight 1WKcCz2BnAQmbhfq:1:r1.
 *
 * Typhoon review: observed spell 61391 is the retail cast/knockback ID for the
 * existing `druid.soft-cc.typhoon` entry (primary 132469) — alias, not a new ability.
 *
 * Terror of the Skies review (372245): applydebuff-only on the Interrupts stream,
 * temporally correlated with Breath of Eons (442204) casts. Treated as a triggered
 * child stun of Breath of Eons + Terror talent — not a standalone Utility activation.
 * Left intentionally unresolved until Breath of Eons has an explicit Utility policy.
 */
import { describe, expect, it } from "vitest";
import {
  dimensionTagsForRule,
  getAllRegisteredRules,
  getAbilityCatalog,
  rulesForSpell,
} from "./index.js";

function ruleByKey(key: string) {
  const rule = getAllRegisteredRules().find((r) => r.canonicalKey === key);
  expect(rule, key).toBeTruthy();
  return rule!;
}

describe("proven utility catalog gap closures (1WKcCz2BnAQmbhfq:1)", () => {
  it("maps Axe Toss cast ID 119914 to warlock.interrupt.axe-toss", () => {
    const catalog = getAbilityCatalog({ classSlug: "warlock", specSlug: "demonology" });
    const matched = rulesForSpell(catalog, 119914);
    expect(matched.some((r) => r.canonicalKey === "warlock.interrupt.axe-toss")).toBe(true);
    expect(ruleByKey("warlock.interrupt.axe-toss").aliases).toEqual(
      expect.arrayContaining([347008, 119914]),
    );
  });

  it("maps Singe Magic buff aura 1276623 to warlock.dispel.singe-magic", () => {
    const catalog = getAbilityCatalog({ classSlug: "warlock", specSlug: "demonology" });
    const matched = rulesForSpell(catalog, 1276623);
    expect(matched.some((r) => r.canonicalKey === "warlock.dispel.singe-magic")).toBe(true);
    expect(ruleByKey("warlock.dispel.singe-magic").aliases).toEqual(
      expect.arrayContaining([132411, 1276623]),
    );
  });

  it("registers Soulstone as BATTLE_REZ with UTILITY_COMBAT_RES", () => {
    const rule = ruleByKey("warlock.battle-rez.soulstone");
    expect(rule.spellIds).toContain(20707);
    expect(rule.category).toBe("BATTLE_REZ");
    expect(dimensionTagsForRule(rule)).toEqual(["UTILITY_COMBAT_RES"]);
  });

  it("credits Cauterizing Flame as Utility DISPEL (not Survival DEFENSIVE_MAJOR)", () => {
    const rule = ruleByKey("evoker.dispel.cauterizing-flame");
    expect(rule.spellIds).toContain(374251);
    expect(rule.category).toBe("DISPEL");
    expect(dimensionTagsForRule(rule)).toEqual(["UTILITY_DISPEL"]);
    expect(
      getAllRegisteredRules().some(
        (r) => r.canonicalKey === "evoker.defensive-major.cauterizing-flame",
      ),
    ).toBe(false);
  });

  it("maps Typhoon knockback/cast ID 61391 to existing soft-cc Typhoon", () => {
    const catalog = getAbilityCatalog({ classSlug: "druid", specSlug: "restoration" });
    const matched = rulesForSpell(catalog, 61391);
    expect(matched.some((r) => r.canonicalKey === "druid.soft-cc.typhoon")).toBe(true);
    expect(ruleByKey("druid.soft-cc.typhoon").aliases).toEqual(
      expect.arrayContaining([61391]),
    );
  });

  it("does not register Terror of the Skies 372245 as a standalone Utility rule", () => {
    const matches = getAllRegisteredRules().filter((r) =>
      [...r.spellIds, ...(r.aliases ?? [])].includes(372245),
    );
    expect(matches).toEqual([]);
  });
});
