/**
 * Catalog-driven AbilityRule identifier resolution — collision-safe.
 */
import { describe, expect, it } from "vitest";
import {
  dimensionTagsForRule,
  getAllRegisteredRules,
  isDigestRelevantRule,
  resolveAbilityRuleBySpellId,
  ruleResolvableSpellIds,
  type AbilityRule,
} from "./index.js";

function scoringRelevantRules(): AbilityRule[] {
  return getAllRegisteredRules().filter((rule) => isDigestRelevantRule(rule));
}

describe("ruleResolvableSpellIds / resolveAbilityRuleBySpellId", () => {
  it("includes every supported identifier form for scoring-relevant rules", () => {
    for (const rule of scoringRelevantRules()) {
      const ids = ruleResolvableSpellIds(rule);
      for (const id of rule.spellIds) expect(ids).toContain(id);
      for (const id of rule.aliases ?? []) expect(ids).toContain(id);
      for (const id of rule.activationSpellIds ?? []) expect(ids).toContain(id);
      for (const id of rule.activationBuffIds ?? []) expect(ids).toContain(id);
      for (const id of rule.triggeredEffectIds ?? []) expect(ids).toContain(id);
      expect(ids).toEqual([...ids].sort((a, b) => a - b));
    }
  });

  it("resolves every resolvable ID back to the owning rule when class/spec disambiguate", () => {
    for (const rule of scoringRelevantRules()) {
      for (const spellId of ruleResolvableSpellIds(rule)) {
        const resolution = resolveAbilityRuleBySpellId({
          spellId,
          classSlug: rule.classSlug,
          specSlug: rule.specSlugs[0] ?? null,
        });
        if (resolution.status === "unmatched") {
          throw new Error(`unmatched ${spellId} for ${rule.canonicalKey}`);
        }
        if (resolution.status === "matched") {
          expect(resolution.rule.canonicalKey).toBe(rule.canonicalKey);
          expect(resolution.matchedSpellId).toBe(spellId);
        } else {
          // Ambiguous only when multiple catalog rules share the ID under the same scope.
          expect(resolution.rules.some((r) => r.canonicalKey === rule.canonicalKey)).toBe(
            true,
          );
          expect(resolution.rules.map((r) => r.canonicalKey)).toEqual(
            [...resolution.rules.map((r) => r.canonicalKey)].sort(),
          );
        }
      }
    }
  });

  it("does not silently pick a rule on ambiguous IDs without class/spec", () => {
    const byId = new Map<number, AbilityRule[]>();
    for (const rule of getAllRegisteredRules()) {
      for (const id of ruleResolvableSpellIds(rule)) {
        const list = byId.get(id) ?? [];
        list.push(rule);
        byId.set(id, list);
      }
    }
    const ambiguousId = [...byId.entries()].find(([, rules]) => rules.length > 1)?.[0];
    if (ambiguousId == null) {
      // Catalog currently has no global collisions — still assert unmatched behavior.
      const resolution = resolveAbilityRuleBySpellId({ spellId: 999_999_001 });
      expect(resolution.status).toBe("unmatched");
      return;
    }
    const resolution = resolveAbilityRuleBySpellId({ spellId: ambiguousId });
    expect(resolution.status).toBe("ambiguous");
    if (resolution.status === "ambiguous") {
      expect(resolution.rules.length).toBeGreaterThan(1);
    }
  });

  it("tags scoring-relevant rules with at least one dimension tag", () => {
    for (const rule of scoringRelevantRules()) {
      expect(dimensionTagsForRule(rule).length).toBeGreaterThan(0);
    }
  });
});
