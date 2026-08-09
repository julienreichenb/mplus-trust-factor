/**
 * Utility Ability Catalog category inventory — no category may disappear silently.
 */
import { describe, expect, it } from "vitest";
import {
  getAllRegisteredRules,
  type AbilityCategory,
} from "@mplus/abilities";
import { mapAbilityCategoryToUtilityCategory } from "./types.js";

/** Catalog categories that Utility may observe / score. */
const UTILITY_CATALOG_CATEGORIES: AbilityCategory[] = [
  "INTERRUPT",
  "HARD_CC",
  "SOFT_CC",
  "DISPEL",
  "PURGE",
  "EXTERNAL_DEFENSIVE",
  "GROUP_UTILITY",
  "MOVEMENT_UTILITY",
  "BATTLE_REZ",
  "BLOODLUST",
];

type CategoryDisposition = "scored" | "observed_non_scoring";

/**
 * Explicit dispositions for Utility V2 observed-contribution scoring.
 * Opportunity/context based — never naive runDuration/cooldown expected uses.
 */
const CATEGORY_DISPOSITION: Record<
  (typeof UTILITY_CATALOG_CATEGORIES)[number],
  CategoryDisposition
> = {
  INTERRUPT: "scored",
  HARD_CC: "scored",
  SOFT_CC: "scored",
  DISPEL: "scored",
  PURGE: "scored",
  EXTERNAL_DEFENSIVE: "scored",
  BATTLE_REZ: "scored",
  BLOODLUST: "scored",
  // Persisted as OTHER_UTILITY actions; not in castStops/support/strategicCc domains.
  GROUP_UTILITY: "observed_non_scoring",
  MOVEMENT_UTILITY: "observed_non_scoring",
};

describe("Utility catalog category inventory", () => {
  it("maps every utility catalog category explicitly (none silent)", () => {
    for (const category of UTILITY_CATALOG_CATEGORIES) {
      const mapped = mapAbilityCategoryToUtilityCategory(category);
      expect(mapped, `${category} must map`).not.toBeNull();
      expect(CATEGORY_DISPOSITION[category]).toBeTruthy();
    }
  });

  it("classifies scored vs observed-non-scoring; OTHER_UTILITY is the sink", () => {
    const scored = UTILITY_CATALOG_CATEGORIES.filter(
      (c) => CATEGORY_DISPOSITION[c] === "scored",
    );
    const observedNonScoring = UTILITY_CATALOG_CATEGORIES.filter(
      (c) => CATEGORY_DISPOSITION[c] === "observed_non_scoring",
    );
    expect(scored).toEqual(
      expect.arrayContaining([
        "INTERRUPT",
        "HARD_CC",
        "SOFT_CC",
        "DISPEL",
        "PURGE",
        "EXTERNAL_DEFENSIVE",
        "BATTLE_REZ",
        "BLOODLUST",
      ]),
    );
    expect(observedNonScoring).toEqual(["GROUP_UTILITY", "MOVEMENT_UTILITY"]);
    expect(mapAbilityCategoryToUtilityCategory("GROUP_UTILITY")).toBe(
      "OTHER_UTILITY",
    );
    expect(mapAbilityCategoryToUtilityCategory("MOVEMENT_UTILITY")).toBe(
      "OTHER_UTILITY",
    );
  });

  it("registered utility catalog rules resolve to a mapped category", () => {
    const rules = getAllRegisteredRules().filter((r) =>
      UTILITY_CATALOG_CATEGORIES.includes(r.category),
    );
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      expect(
        mapAbilityCategoryToUtilityCategory(rule.category),
        rule.canonicalKey,
      ).not.toBeNull();
    }
  });
});
