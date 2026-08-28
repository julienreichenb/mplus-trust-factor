import { describe, expect, it } from "vitest";
import {
  CURRENT_CATALOG_VERSION_ID,
  getAbilityCatalog,
  getAllRegisteredRules,
  resolveAbilityRuleBySpellId,
  RETAIL_ABILITY_CATALOG,
} from "./index.js";
import { SHARED_RACIAL_RULES } from "./catalog/shared/racials.js";
import { CURRENT_CATALOG_VERSION } from "./version.js";

describe("shadow refresh must not cut over runtime catalog", () => {
  it("keeps RETAIL_ABILITY_CATALOG identity, keys, version, and resolution", () => {
    const rules = getAllRegisteredRules();
    expect(RETAIL_ABILITY_CATALOG.rules).toHaveLength(rules.length);
    expect(RETAIL_ABILITY_CATALOG.catalogVersion).toBe(CURRENT_CATALOG_VERSION_ID);
    expect(RETAIL_ABILITY_CATALOG.version).toEqual(CURRENT_CATALOG_VERSION);
    expect(rules.map((r) => r.canonicalKey).sort()).toEqual(
      RETAIL_ABILITY_CATALOG.rules.map((r) => r.canonicalKey).sort(),
    );
    expect(rules.some((r) => r.canonicalKey === "mage.offensive.icy-veins")).toBe(true);
    expect(rules.some((r) => r.canonicalKey === "priest.shadow.vampiric-embrace")).toBe(false);
    const icy = resolveAbilityRuleBySpellId({ spellId: 12472, classSlug: "mage", specSlug: "frost" });
    expect(icy.status).toBe("matched");
    if (icy.status === "matched") {
      expect(icy.rule.canonicalKey).toBe("mage.offensive.icy-veins");
    }
    const frost = getAbilityCatalog({ classSlug: "mage", specSlug: "frost", role: "DPS" });
    expect(frost.rules.some((r) => r.canonicalKey === "mage.offensive.icy-veins")).toBe(true);
    const shadow = getAbilityCatalog({ classSlug: "priest", specSlug: "shadow", role: "DPS" });
    expect(shadow.rules.some((r) => /vampiric-embrace/.test(r.canonicalKey))).toBe(false);
    expect(rules.filter((r) => r.canonicalKey.startsWith("shared.racial.")).map((r) => r.canonicalKey).sort()).toEqual(
      SHARED_RACIAL_RULES.map((r) => r.canonicalKey).sort(),
    );
  });

  it("does not import extract tooling through the scoring catalog surface", async () => {
    const mod = await import("./index.js");
    expect("extractSimcSpellQuerySnapshot" in mod).toBe(false);
    expect("extractBlizzardRefreshSnapshot" in mod).toBe(false);
  });
});
