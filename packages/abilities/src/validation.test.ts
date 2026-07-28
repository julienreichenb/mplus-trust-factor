import { describe, expect, it } from "vitest";
import { validateAbilityCatalog } from "./validation.js";
import { getAllRegisteredRules, getCatalogByVersion } from "./registry.js";
import { rule } from "./catalog/rule.js";
import type { AbilityRule } from "./types.js";

function syntheticBase(overrides: Partial<Parameters<typeof rule>[0]> = {}): AbilityRule {
  return rule({
    canonicalKey: "synthetic.test.ability",
    name: "Synthetic Test Ability",
    spellIds: [9_999_001],
    classSlug: "mage",
    specSlugs: ["fire"],
    roles: ["DPS"],
    category: "INTERRUPT",
    ...overrides,
  });
}

describe("validateAbilityCatalog", () => {
  it("real registry catalog is valid (errors empty; warnings allowed)", () => {
    const report = validateAbilityCatalog();
    expect(report.errors).toEqual([]);
    expect(report.valid).toBe(true);
    expect(report.generatedAt).toBeTruthy();
  });

  it("detects duplicate spell id conflicts across different semantics", () => {
    const sharedSpellId = 9_999_101;
    const rules: AbilityRule[] = [
      syntheticBase({
        canonicalKey: "synthetic.conflict.a",
        spellIds: [sharedSpellId],
        category: "INTERRUPT",
        classSlug: "mage",
      }),
      syntheticBase({
        canonicalKey: "synthetic.conflict.b",
        spellIds: [sharedSpellId],
        category: "HARD_CC",
        classSlug: "mage",
      }),
    ];

    const report = validateAbilityCatalog(rules);
    expect(report.valid).toBe(false);
    expect(report.errors.some((e) => e.code === "DUPLICATE_SPELL_CONFLICT")).toBe(true);
  });

  it("detects duplicate canonical keys", () => {
    const duplicate = syntheticBase({ canonicalKey: "synthetic.duplicate.key", spellIds: [9_999_201] });
    const report = validateAbilityCatalog([duplicate, { ...duplicate }]);
    expect(report.valid).toBe(false);
    expect(report.errors.some((e) => e.code === "DUPLICATE_CANONICAL_KEY")).toBe(true);
  });

  it("detects invalid spec references on class rules", () => {
    const badSpec = syntheticBase({
      canonicalKey: "synthetic.bad-spec",
      spellIds: [9_999_301],
      specSlugs: ["not-a-real-spec"],
    });
    const report = validateAbilityCatalog([badSpec]);
    expect(report.valid).toBe(false);
    expect(report.errors.some((e) => e.code === "UNKNOWN_SPEC")).toBe(true);
  });

  it("detects replacement cycles", () => {
    const ruleA = syntheticBase({
      canonicalKey: "synthetic.replacement.a",
      spellIds: [9_999_401],
      replacementFor: "synthetic.replacement.b",
    });
    const ruleB = syntheticBase({
      canonicalKey: "synthetic.replacement.b",
      spellIds: [9_999_402],
      replacementFor: "synthetic.replacement.a",
    });
    const report = validateAbilityCatalog([ruleA, ruleB]);
    expect(report.valid).toBe(false);
    expect(report.errors.some((e) => e.code === "REPLACEMENT_CYCLE")).toBe(true);
  });

  it("detects missing provenance fields", () => {
    const base = syntheticBase({
      canonicalKey: "synthetic.missing-provenance",
      spellIds: [9_999_501],
    });
    const broken: AbilityRule = {
      ...base,
      provenance: { source: "CURATED_OVERRIDE", verifiedAt: "", gameVersion: "" },
    };
    const report = validateAbilityCatalog([broken]);
    expect(report.valid).toBe(false);
    expect(report.errors.some((e) => e.code === "MISSING_PROVENANCE")).toBe(true);
  });

  it("getCatalogByVersion resolves historical 11.1.0 pin and null for unknown", () => {
    const historical = getCatalogByVersion("11.1.0");
    expect(historical).not.toBeNull();
    expect(historical!.version.gameVersion).toBe("11.1.0");
    expect(historical!.rules.length).toBeGreaterThan(0);

    expect(getCatalogByVersion("99.99.99")).toBeNull();
  });

  it("duplicate spell with same semantics yields warning not error", () => {
    const sharedSpellId = 9_999_601;
    const a = syntheticBase({
      canonicalKey: "synthetic.same-semantics.a",
      spellIds: [sharedSpellId],
      category: "INTERRUPT",
    });
    const b = syntheticBase({
      canonicalKey: "synthetic.same-semantics.b",
      spellIds: [sharedSpellId],
      category: "INTERRUPT",
    });
    const report = validateAbilityCatalog([a, b]);
    expect(report.errors.some((e) => e.code === "DUPLICATE_SPELL_CONFLICT")).toBe(false);
    expect(report.warnings.some((e) => e.code === "DUPLICATE_SPELL_SAME_SEMANTICS")).toBe(true);
  });

  it("registry export includes every registered rule key", () => {
    const keys = new Set(getAllRegisteredRules().map((r) => r.canonicalKey));
    expect(keys.has("warrior.interrupt.pummel")).toBe(true);
    expect(keys.has("shared.consumable.healthstone")).toBe(true);
    expect(keys.size).toBeGreaterThan(50);
  });
});
