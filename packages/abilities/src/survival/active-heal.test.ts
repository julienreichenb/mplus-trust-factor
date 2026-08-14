import { describe, expect, it } from "vitest";
import { getAllRegisteredRules, isSurvivalActiveHealRule } from "../index.js";

describe("Survival active-heal catalog eligibility", () => {
  const rules = getAllRegisteredRules().filter((r) => r.survivalActiveHeal);

  it("covers Retribution, Protection, and Enhancement only", () => {
    const specs = new Set(rules.flatMap((r) => r.specSlugs));
    expect([...specs].sort()).toEqual(["enhancement", "protection", "retribution"]);
    expect(rules.every((r) => r.classSlug === "paladin" || r.classSlug === "shaman")).toBe(true);
  });

  it("does not flag healer specs", () => {
    for (const rule of getAllRegisteredRules()) {
      expect(isSurvivalActiveHealRule(rule, "paladin", "holy")).toBe(false);
      expect(isSurvivalActiveHealRule(rule, "shaman", "restoration")).toBe(false);
      expect(isSurvivalActiveHealRule(rule, "priest", "holy")).toBe(false);
    }
  });

  it("matches eligible spells for hybrid specs", () => {
    const retLoH = getAllRegisteredRules().find((r) => r.canonicalKey === "paladin.active-heal.lay-on-hands");
    const enhSurge = getAllRegisteredRules().find((r) => r.canonicalKey === "shaman.active-heal.healing-surge");
    expect(retLoH && isSurvivalActiveHealRule(retLoH, "paladin", "retribution")).toBe(true);
    expect(retLoH && isSurvivalActiveHealRule(retLoH, "paladin", "protection")).toBe(true);
    expect(enhSurge && isSurvivalActiveHealRule(enhSurge, "shaman", "enhancement")).toBe(true);
    expect(enhSurge && isSurvivalActiveHealRule(enhSurge, "shaman", "elemental")).toBe(false);
  });
});
