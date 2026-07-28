import type {
  AbilityCatalog,
  AbilityRule,
  ScoringAbilityCategory,
} from "./types.js";
import { expandScoringCategory } from "./registry.js";

function ruleSpellIds(rule: AbilityRule): number[] {
  return [...rule.spellIds, ...(rule.aliases ?? [])];
}

function matchesClassSpec(
  rule: AbilityRule,
  options: { classSlug?: string; specSlug?: string | null },
): boolean {
  if (options.classSlug) {
    if (rule.classSlug != null && rule.classSlug !== options.classSlug) return false;
  }
  if (options.specSlug && rule.classSlug != null && rule.specSlugs.length > 0) {
    if (!rule.specSlugs.includes(options.specSlug)) return false;
  }
  return true;
}

export function rulesForSpell(catalog: AbilityCatalog, spellId: number): AbilityRule[] {
  return catalog.rules.filter((r) => ruleSpellIds(r).includes(spellId));
}

export function rulesForCategory(
  catalog: AbilityCatalog,
  category: ScoringAbilityCategory,
  options: { classSlug?: string; specSlug?: string | null } = {},
): AbilityRule[] {
  const expanded = expandScoringCategory(category);
  return catalog.rules.filter((rule) => {
    if (!expanded.includes(rule.category)) return false;
    return matchesClassSpec(rule, options);
  });
}

export function spellIdsForCategory(
  catalog: AbilityCatalog,
  category: ScoringAbilityCategory,
  options: { classSlug?: string; specSlug?: string | null } = {},
): Set<number> {
  const ids = new Set<number>();
  for (const rule of rulesForCategory(catalog, category, options)) {
    for (const id of ruleSpellIds(rule)) ids.add(id);
  }
  return ids;
}

export function effectiveKickCooldownMs(
  catalog: AbilityCatalog,
  classSlug: string,
  specSlug: string | null,
): number | null {
  const interrupts = rulesForCategory(catalog, "INTERRUPT", { classSlug, specSlug });
  if (interrupts.length === 0) return null;
  return Math.min(...interrupts.map((r) => (r.cooldownSeconds ?? 24) * 1000));
}
