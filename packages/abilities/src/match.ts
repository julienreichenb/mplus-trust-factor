import type { AbilityCatalog, AbilityCategory, AbilityRule, LegacyAbilityCategory } from "./types.js";

const LEGACY_CATEGORY_MAP: Record<LegacyAbilityCategory, AbilityCategory | AbilityCategory[]> = {
  interrupt: "INTERRUPT",
  crowd_control: ["HARD_CC", "SOFT_CC"],
  personal_defensive: ["DEFENSIVE_MAJOR", "DEFENSIVE_MINOR"],
  self_heal: "SELF_HEAL",
  health_potion: "CONSUMABLE",
  group_support: ["GROUP_UTILITY", "MOVEMENT_UTILITY", "EXTERNAL_DEFENSIVE"],
  defensive_dispel: "DISPEL",
  offensive_dispel: "PURGE",
};

export function normalizeCategory(category: AbilityCategory | LegacyAbilityCategory): AbilityCategory[] {
  if (category in LEGACY_CATEGORY_MAP) {
    const mapped = LEGACY_CATEGORY_MAP[category as LegacyAbilityCategory];
    return Array.isArray(mapped) ? mapped : [mapped];
  }
  return [category as AbilityCategory];
}

export function ruleMatchesCategory(rule: AbilityRule, category: AbilityCategory | LegacyAbilityCategory): boolean {
  const targets = normalizeCategory(category);
  return targets.includes(rule.category);
}

export function rulesForSpell(catalog: AbilityCatalog, spellId: number): AbilityRule[] {
  return catalog.rules.filter((r) => r.spellIds.includes(spellId));
}

export function rulesForCategory(
  catalog: AbilityCatalog,
  category: AbilityCategory | LegacyAbilityCategory,
  options: { classSlug?: string | null; specSlug?: string | null; role?: string | null } = {},
): AbilityRule[] {
  return catalog.rules.filter((rule) => {
    if (!ruleMatchesCategory(rule, category)) return false;
    if (options.classSlug && rule.classSlug != null && rule.classSlug !== options.classSlug) return false;
    if (options.specSlug && rule.specSlugs.length > 0 && !rule.specSlugs.includes(options.specSlug)) {
      return false;
    }
    if (options.role && rule.roles.length > 0 && !rule.roles.includes(options.role as AbilityRule["roles"][number])) {
      return false;
    }
    return true;
  });
}

export function spellIdsForCategory(
  catalog: AbilityCatalog,
  category: AbilityCategory | LegacyAbilityCategory,
  options: { classSlug?: string | null; specSlug?: string | null; role?: string | null } = {},
): Set<number> {
  const ids = new Set<number>();
  for (const rule of rulesForCategory(catalog, category, options)) {
    for (const id of rule.spellIds) ids.add(id);
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
