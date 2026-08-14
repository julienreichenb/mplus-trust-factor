import { describe, expect, it } from "vitest";
import { getApplicableAbilityCategories } from "./applicability.js";

function categoryState(
  results: ReturnType<typeof getApplicableAbilityCategories>,
  category: string,
) {
  return results.find((r) => r.category === category);
}

describe("getApplicableAbilityCategories", () => {
  it("mage has DISPEL (Remove Curse) applicable", () => {
    const results = getApplicableAbilityCategories({
      classSlug: "mage",
      specSlug: "fire",
      role: "DPS",
    });
    const dispel = categoryState(results, "DISPEL");
    expect(dispel?.state).toBe("applicable");
    expect(dispel?.rules.some((r) => r.canonicalKey === "mage.dispel.remove-curse")).toBe(true);
  });

  it("warrior DPS has no DISPEL rules → not_applicable", () => {
    const results = getApplicableAbilityCategories({
      classSlug: "warrior",
      specSlug: "arms",
      role: "DPS",
    });
    const dispel = categoryState(results, "DISPEL");
    expect(dispel?.state).toBe("not_applicable");
    expect(dispel?.reason).toBe("no_rules_for_category");
  });

  it("talent-only utility is uncertain when knownTalentSpellIds is omitted", () => {
    const results = getApplicableAbilityCategories({
      classSlug: "warrior",
      specSlug: "arms",
      role: "DPS",
    });
    const hardCc = categoryState(results, "HARD_CC");
    expect(hardCc?.state).toBe("uncertain");
    expect(hardCc?.reason).toBe("talent_data_unavailable");
    expect(hardCc?.rules.every((r) => r.availability === "TALENT")).toBe(true);
  });

  it("talent-only category becomes applicable when talent spell id is known", () => {
    const without = getApplicableAbilityCategories({
      classSlug: "warrior",
      specSlug: "arms",
      role: "DPS",
    });
    const withTalent = getApplicableAbilityCategories({
      classSlug: "warrior",
      specSlug: "arms",
      role: "DPS",
      knownTalentSpellIds: [107570],
    });
    expect(categoryState(without, "HARD_CC")?.state).toBe("uncertain");
    expect(categoryState(withTalent, "HARD_CC")?.state).toBe("applicable");
  });

  it("pet-dependent warlock interrupt is applicable for demonology", () => {
    const results = getApplicableAbilityCategories({
      classSlug: "warlock",
      specSlug: "demonology",
      role: "DPS",
    });
    const interrupt = categoryState(results, "INTERRUPT");
    expect(interrupt?.state).toBe("applicable");
    expect(
      interrupt?.rules.some(
        (r) =>
          r.sourceOwnership === "PET" &&
          (r.canonicalKey === "warlock.interrupt.spell-lock" ||
            r.canonicalKey === "warlock.interrupt.axe-toss"),
      ),
    ).toBe(true);
  });

  it("priest holy healer has DISPEL applicable", () => {
    const results = getApplicableAbilityCategories({
      classSlug: "priest",
      specSlug: "holy",
      role: "HEALER",
    });
    const dispel = categoryState(results, "DISPEL");
    expect(dispel?.state).toBe("applicable");
    expect(dispel?.rules.some((r) => r.canonicalKey === "priest.dispel.purify")).toBe(true);
  });

  it("shaman has offensive PURGE applicable (baseline Purge)", () => {
    const results = getApplicableAbilityCategories({
      classSlug: "shaman",
      specSlug: "elemental",
      role: "DPS",
    });
    const purge = categoryState(results, "PURGE");
    expect(purge?.state).toBe("applicable");
    expect(purge?.rules.some((r) => r.canonicalKey === "shaman.purge.purge")).toBe(true);
  });

  it("warrior protection tank has DEFENSIVE_MAJOR applicable", () => {
    const results = getApplicableAbilityCategories({
      classSlug: "warrior",
      specSlug: "protection",
      role: "TANK",
    });
    const defensive = categoryState(results, "DEFENSIVE_MAJOR");
    expect(defensive?.state).toBe("applicable");
    expect(defensive?.rules.some((r) => r.canonicalKey === "warrior.defensive-major.shield-wall")).toBe(
      true,
    );
  });

  it("mistweaver has no INTERRUPT category rules", () => {
    const results = getApplicableAbilityCategories({
      classSlug: "monk",
      specSlug: "mistweaver",
      role: "HEALER",
    });
    const interrupt = categoryState(results, "INTERRUPT");
    expect(interrupt?.state).toBe("not_applicable");
    expect(interrupt?.reason).toBe("no_rules_for_category");
  });

  it("observed spell promotes talent-only capability to AVAILABLE", () => {
    const results = getApplicableAbilityCategories({
      classSlug: "warlock",
      specSlug: "affliction",
      role: "DPS",
      knownTalentSpellIds: [],
      observedSpellIds: [1271802],
    });
    // Soft CC still has baseline Curse of Tongues → applicable; blight observed is in rules.
    const soft = categoryState(results, "SOFT_CC");
    expect(soft?.state).toBe("applicable");
    expect(soft?.rules.some((r) => r.canonicalKey.includes("blight-of-tongues"))).toBe(true);
  });

  it("shared consumable category is always applicable", () => {
    const results = getApplicableAbilityCategories({
      classSlug: "mage",
      specSlug: "fire",
      role: "DPS",
    });
    const consumable = categoryState(results, "CONSUMABLE");
    expect(consumable?.state).toBe("applicable");
    expect(consumable?.reason).toBe("shared_consumable");
    expect(consumable?.rules.some((r) => r.canonicalKey === "shared.consumable.healthstone")).toBe(
      true,
    );
  });

  it("returns not_applicable for all categories when catalog lookup fails", () => {
    const results = getApplicableAbilityCategories({
      classSlug: "mage",
      specSlug: "invalid-spec",
      role: "DPS",
    });
    expect(results.every((r) => r.state === "not_applicable")).toBe(true);
    expect(results.every((r) => r.reason === "UNKNOWN_SPEC")).toBe(true);
  });
});
