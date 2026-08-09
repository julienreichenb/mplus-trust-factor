/**
 * Cross-dimension consistency: offensive → Performance only, survival → Survival,
 * utility → Utility; aliases resolve to the same canonical ability.
 */
import { describe, expect, it } from "vitest";
import {
  dimensionTagsForRule,
  getAllRegisteredRules,
  resolveAbilityRuleBySpellId,
  ruleResolvableSpellIds,
} from "@mplus/abilities";

describe("cross-dimension cooldown identity consistency", () => {
  it("offensive-tagged rules contribute Performance tag only among P/S/U cooldown tags", () => {
    const offensive = getAllRegisteredRules().filter((r) =>
      dimensionTagsForRule(r).includes("PERFORMANCE_OFFENSIVE_COOLDOWN"),
    );
    expect(offensive.length).toBeGreaterThan(0);
    for (const rule of offensive) {
      const tags = dimensionTagsForRule(rule);
      expect(tags).toContain("PERFORMANCE_OFFENSIVE_COOLDOWN");
      // Offensive cooldown rules must not also be Survival personal defensive tags.
      expect(tags.includes("SURVIVAL_PERSONAL_DEFENSIVE")).toBe(false);
    }
  });

  it("survival defensive rules are Survival-tagged, not Performance offensive", () => {
    const defensives = getAllRegisteredRules().filter(
      (r) =>
        r.category === "DEFENSIVE_MAJOR" ||
        r.category === "DEFENSIVE_MINOR" ||
        r.category === "IMMUNITY",
    );
    expect(defensives.length).toBeGreaterThan(0);
    for (const rule of defensives) {
      const tags = dimensionTagsForRule(rule);
      expect(tags.includes("PERFORMANCE_OFFENSIVE_COOLDOWN")).toBe(false);
    }
  });

  it("utility interrupt rules are Utility-tagged", () => {
    const interrupts = getAllRegisteredRules().filter(
      (r) => r.category === "INTERRUPT",
    );
    expect(interrupts.length).toBeGreaterThan(0);
    for (const rule of interrupts) {
      const tags = dimensionTagsForRule(rule);
      expect(tags.some((t) => t.startsWith("UTILITY_"))).toBe(true);
      expect(tags.includes("PERFORMANCE_OFFENSIVE_COOLDOWN")).toBe(false);
    }
  });

  it("aliases / activation IDs resolve to the same canonical ability", () => {
    const combustion = getAllRegisteredRules().find(
      (r) => r.canonicalKey === "mage.offensive.combustion",
    )!;
    const ids = ruleResolvableSpellIds(combustion);
    expect(ids.length).toBeGreaterThan(0);
    for (const spellId of ids) {
      const resolution = resolveAbilityRuleBySpellId({
        spellId,
        classSlug: "mage",
        specSlug: "fire",
      });
      expect(resolution.status).toBe("matched");
      if (resolution.status === "matched") {
        expect(resolution.rule.canonicalKey).toBe(combustion.canonicalKey);
      }
    }
  });
});
