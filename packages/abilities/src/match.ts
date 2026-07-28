import type { AbilityCatalog, AbilityCategory, AbilityRule } from "./types.js";

export function rulesForSpell(catalog: AbilityCatalog, spellId: number): AbilityRule[] {
  return catalog.rules.filter((r) => r.spellId === spellId);
}

export function rulesForCategory(
  catalog: AbilityCatalog,
  category: AbilityCategory,
  options: { classSlug?: string; specSlug?: string | null } = {},
): AbilityRule[] {
  return catalog.rules.filter((rule) => {
    if (!rule.categories.includes(category)) return false;
    if (options.classSlug && rule.classSlug !== options.classSlug) return false;
    if (options.specSlug && rule.specSlugs && !rule.specSlugs.includes(options.specSlug)) {
      return false;
    }
    return true;
  });
}

export function spellIdsForCategory(
  catalog: AbilityCatalog,
  category: AbilityCategory,
  options: { classSlug?: string; specSlug?: string | null } = {},
): Set<number> {
  return new Set(rulesForCategory(catalog, category, options).map((r) => r.spellId));
}

export function effectiveKickCooldownMs(
  catalog: AbilityCatalog,
  classSlug: string,
  specSlug: string | null,
): number | null {
  const interrupts = rulesForCategory(catalog, "interrupt", { classSlug, specSlug });
  if (interrupts.length === 0) return null;
  return Math.min(...interrupts.map((r) => r.baseCooldownMs ?? 24_000));
}
