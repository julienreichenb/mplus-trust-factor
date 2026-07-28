import type { AbilityCatalog, AbilityCategory } from "./ability-types.js";
import { resolveEffectiveCooldownMs } from "./ability-types.js";

function matchesClassSpec(
  rule: { classSlug: string; specSlugs?: string[] },
  classSlug: string | null | undefined,
  specSlug: string | null | undefined,
): boolean {
  if (rule.classSlug !== "*" && classSlug && rule.classSlug !== classSlug) return false;
  if (rule.specSlugs && specSlug && !rule.specSlugs.includes(specSlug)) return false;
  return true;
}

function rulesForCategory(
  catalog: AbilityCatalog,
  category: AbilityCategory,
  classSlug: string | null | undefined,
  specSlug: string | null | undefined,
) {
  return catalog.rules.filter(
    (rule) =>
      rule.categories.includes(category) && matchesClassSpec(rule, classSlug, specSlug),
  );
}

/** Whether the class/spec has at least one personal_defensive catalog rule. */
export function hasAbilityCategory(
  catalog: AbilityCatalog,
  category: AbilityCategory,
  classSlug?: string | null,
  specSlug?: string | null,
): boolean {
  return rulesForCategory(catalog, category, classSlug, specSlug).length > 0;
}

/**
 * Estimate available personal-defensive uses from catalog cooldowns × run duration.
 * Distinct spell IDs are summed; rules without baseCooldownMs are ignored.
 */
export function estimateAvailableDefensiveUses(input: {
  abilityCatalog: AbilityCatalog;
  durationMs: number | null;
  classSlug?: string | null;
  specSlug?: string | null;
  talentIds?: ReadonlySet<number>;
}): number | null {
  if (input.durationMs == null || input.durationMs <= 0) return null;
  const rules = rulesForCategory(
    input.abilityCatalog,
    "personal_defensive",
    input.classSlug,
    input.specSlug,
  );
  if (rules.length === 0) return null;

  const bySpell = new Map<number, number>();
  for (const rule of rules) {
    const cd = resolveEffectiveCooldownMs(rule, input.talentIds ?? new Set());
    if (cd == null || cd <= 0) continue;
    const existing = bySpell.get(rule.spellId);
    // Prefer the shortest effective CD when multiple rules share a spell.
    bySpell.set(rule.spellId, existing == null ? cd : Math.min(existing, cd));
  }
  if (bySpell.size === 0) return null;

  let uses = 0;
  for (const cd of bySpell.values()) {
    uses += Math.max(1, Math.floor(input.durationMs / cd));
  }
  return uses;
}
