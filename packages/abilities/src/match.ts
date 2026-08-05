import type {
  AbilityCatalog,
  AbilityCategory,
  AbilityRule,
  LegacyAbilityCategory,
  ScoringAbilityCategory,
} from "./types.js";
import { expandScoringCategory, ruleResolvableSpellIds } from "./registry.js";

function ruleSpellIds(rule: AbilityRule): number[] {
  return [...rule.spellIds, ...(rule.aliases ?? [])];
}

function matchesClassSpec(
  rule: AbilityRule,
  options: { classSlug?: string | null; specSlug?: string | null; role?: string | null },
): boolean {
  if (options.classSlug) {
    if (rule.classSlug != null && rule.classSlug !== options.classSlug) return false;
  }
  if (options.specSlug && rule.classSlug != null && rule.specSlugs.length > 0) {
    if (!rule.specSlugs.includes(options.specSlug)) return false;
  }
  if (options.role && rule.roles.length > 0 && !rule.roles.includes(options.role as AbilityRule["roles"][number])) {
    return false;
  }
  return true;
}

export function ruleMatchesCategory(
  rule: AbilityRule,
  category: ScoringAbilityCategory,
): boolean {
  return expandScoringCategory(category).includes(rule.category);
}

export function rulesForSpell(catalog: AbilityCatalog, spellId: number): AbilityRule[] {
  return catalog.rules.filter((r) => ruleResolvableSpellIds(r).includes(spellId));
}

export function rulesForCategory(
  catalog: AbilityCatalog,
  category: ScoringAbilityCategory,
  options: { classSlug?: string | null; specSlug?: string | null; role?: string | null } = {},
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
  options: { classSlug?: string | null; specSlug?: string | null; role?: string | null } = {},
): Set<number> {
  const ids = new Set<number>();
  for (const rule of rulesForCategory(catalog, category, options)) {
    for (const id of ruleSpellIds(rule)) ids.add(id);
  }
  return ids;
}

export function effectiveKickCooldownMs(
  catalog: AbilityCatalog,
  classSlug: string | null,
  specSlug: string | null,
): number | null {
  const interrupts = rulesForCategory(catalog, "INTERRUPT", { classSlug, specSlug });
  if (interrupts.length === 0) return null;
  return Math.min(...interrupts.map((r) => (r.cooldownSeconds ?? 24) * 1000));
}

/** Categories the catalog claims the toolkit can provide (count > 0). */
export function applicableCategories(catalog: AbilityCatalog): Set<AbilityCategory> {
  const out = new Set<AbilityCategory>();
  for (const rule of catalog.rules) out.add(rule.category);
  return out;
}

/** @deprecated Use expandScoringCategory — legacy alias for Agent 31 callers. */
export function normalizeCategory(category: AbilityCategory | LegacyAbilityCategory): AbilityCategory[] {
  return expandScoringCategory(category);
}
