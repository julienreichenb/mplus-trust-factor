import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CURRENT_CATALOG_VERSION_ID,
  dimensionTagsForRule,
  getAllRegisteredRules,
  getAbilityCatalog,
  resolveAbilityRule,
  RETAIL_ABILITY_CATALOG,
  rulesForSpell,
} from "./index.js";
import type { AbilityRule } from "./types.js";

const srcRoot = join(dirname(fileURLToPath(import.meta.url)));

function offensiveTagged(rules: AbilityRule[]): AbilityRule[] {
  return rules.filter((r) =>
    dimensionTagsForRule(r).includes("PERFORMANCE_OFFENSIVE_COOLDOWN"),
  );
}

describe("canonical catalog unification (Utility / Survival / Performance)", () => {
  it("loads Utility, Survival and Performance entries through one catalog loader", () => {
    const rules = getAllRegisteredRules();
    expect(rules.map((r) => r.canonicalKey).sort()).toEqual(
      RETAIL_ABILITY_CATALOG.rules.map((r) => r.canonicalKey).sort(),
    );
    expect(rules.some((r) => r.category === "INTERRUPT")).toBe(true);
    expect(rules.some((r) => r.category === "DEFENSIVE_MAJOR")).toBe(true);
    expect(rules.some((r) => r.category === "OFFENSIVE_MAJOR")).toBe(true);
    expect(offensiveTagged(rules).length).toBeGreaterThan(50);
  });

  it("shares one AbilityRule entry type across dimensions", () => {
    const interrupt = getAllRegisteredRules().find((r) => r.category === "INTERRUPT")!;
    const defensive = getAllRegisteredRules().find((r) => r.category === "DEFENSIVE_MAJOR")!;
    const offensive = getAllRegisteredRules().find((r) => r.category === "OFFENSIVE_MAJOR")!;
    for (const r of [interrupt, defensive, offensive]) {
      expect(r).toHaveProperty("canonicalKey");
      expect(r).toHaveProperty("spellIds");
      expect(r).toHaveProperty("category");
      expect(r).toHaveProperty("provenance");
      expect(r).not.toHaveProperty("cooldownCategory");
      expect(r).not.toHaveProperty("reviewStatus");
      expect(r).not.toHaveProperty("confidence");
    }
  });

  it("resolves all spell IDs through the same resolver", () => {
    const tyrant = resolveAbilityRule({ spellId: 265187 });
    expect(tyrant.some((r) => r.canonicalKey === "warlock.offensive.demonic-tyrant")).toBe(true);
    const kick = resolveAbilityRule({ spellId: 19647, classSlug: "warlock" });
    expect(kick.some((r) => r.category === "INTERRUPT")).toBe(true);
  });

  it("allows one entry to expose multiple dimension tags", () => {
    const pi = getAllRegisteredRules().find(
      (r) => r.canonicalKey === "priest.group-utility.power-infusion",
    )!;
    const tags = dimensionTagsForRule(pi);
    expect(tags).toContain("UTILITY_EXTERNAL");
    expect(tags).toContain("PERFORMANCE_OFFENSIVE_COOLDOWN");
    expect(offensiveTagged(getAllRegisteredRules()).filter((r) => r.canonicalKey === pi.canonicalKey)).toHaveLength(1);
  });

  it("preserves existing Utility interrupt keys", () => {
    const warlock = getAbilityCatalog({
      classSlug: "warlock",
      specSlug: "demonology",
      role: "DPS",
    });
    expect(warlock.rules.some((r) => r.canonicalKey === "warlock.interrupt.spell-lock")).toBe(true);
  });

  it("preserves existing Survival defensive keys", () => {
    const warlock = getAbilityCatalog({
      classSlug: "warlock",
      specSlug: "demonology",
      role: "DPS",
    });
    expect(
      warlock.rules.some((r) =>
        dimensionTagsForRule(r).includes("SURVIVAL_PERSONAL_DEFENSIVE"),
      ),
    ).toBe(true);
  });

  it("resolves offensive aliases through the canonical alias mechanism", () => {
    // Shadowfiend alias Mindbender summon variant 451235
    const hits = resolveAbilityRule({ spellId: 451235, classSlug: "priest" });
    expect(hits.some((r) => r.canonicalKey === "priest.offensive.shadowfiend")).toBe(true);
  });

  it("resolves triggered effect IDs to the canonical parent ability", () => {
    const parent = getAllRegisteredRules().find(
      (r) => r.canonicalKey === "warlock.offensive.demonic-tyrant",
    )!;
    const withChild: AbilityRule = {
      ...parent,
      triggeredEffectIds: [424242],
    };
    // Patch into catalog lookup via rulesForSpell on a synthetic catalog
    const catalog = { ...RETAIL_ABILITY_CATALOG, rules: [withChild] };
    expect(rulesForSpell(catalog, 424242).map((r) => r.canonicalKey)).toEqual([
      "warlock.offensive.demonic-tyrant",
    ]);
  });

  it("uses a single catalog version for compatibility identity", () => {
    expect(RETAIL_ABILITY_CATALOG.catalogVersion).toBe(CURRENT_CATALOG_VERSION_ID);
    const demo = getAbilityCatalog({
      classSlug: "warlock",
      specSlug: "demonology",
      role: "DPS",
    });
    expect(demo.catalogVersion).toBe(CURRENT_CATALOG_VERSION_ID);
  });

  it("does not import a parallel offensive production registry at runtime", () => {
    const registrySrc = readFileSync(join(srcRoot, "registry.ts"), "utf8");
    expect(registrySrc).not.toMatch(/catalog\/offensive/);
    expect(registrySrc).not.toMatch(/ALL_OFFENSIVE_RULES/);
    expect(registrySrc).not.toMatch(/loadOffensiveCatalog|resolveOffensiveAbility/);
  });
});
