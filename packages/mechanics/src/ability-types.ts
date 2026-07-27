export const ABILITY_CATEGORIES = [
  "interrupt",
  "crowd_control",
  "personal_defensive",
  "self_heal",
  "health_potion",
  "group_support",
  "defensive_dispel",
  "offensive_dispel",
] as const;

export type AbilityCategory = (typeof ABILITY_CATEGORIES)[number];

export interface AbilityCooldownModifier {
  talentId: number;
  multiplier?: number;
  deltaMs?: number;
}

/**
 * Versioned class/spec ability catalog entry.
 * Spell IDs live only in catalog data — never scatter them through scoring code.
 */
export interface AbilityRule {
  spellId: number;
  classSlug: string;
  specSlugs?: string[];
  categories: AbilityCategory[];
  baseCooldownMs?: number;
  petRequirement?: string;
  talentRequirements?: number[];
  cooldownModifiers?: AbilityCooldownModifier[];
  validFromBuild?: string;
  validToBuild?: string;
  notes?: string;
}

export interface AbilityCatalog {
  catalogVersion: string;
  seasonSlug: string | null;
  rules: AbilityRule[];
}

export function createEmptyAbilityCatalog(catalogVersion = "0.0.0"): AbilityCatalog {
  return { catalogVersion, seasonSlug: null, rules: [] };
}

export function validateAbilityRule(rule: AbilityRule): string[] {
  const errors: string[] = [];
  if (!Number.isFinite(rule.spellId) || rule.spellId <= 0) {
    errors.push("spellId must be a positive number");
  }
  if (!rule.classSlug) errors.push("classSlug is required");
  if (!Array.isArray(rule.categories) || rule.categories.length === 0) {
    errors.push("categories must be non-empty");
  } else {
    for (const category of rule.categories) {
      if (!ABILITY_CATEGORIES.includes(category)) {
        errors.push(`unsupported category: ${String(category)}`);
      }
    }
  }
  if (rule.baseCooldownMs != null && !(rule.baseCooldownMs > 0)) {
    errors.push("baseCooldownMs must be > 0 when set");
  }
  if (rule.specSlugs != null && !Array.isArray(rule.specSlugs)) {
    errors.push("specSlugs must be an array when set");
  }
  if (rule.talentRequirements != null && !Array.isArray(rule.talentRequirements)) {
    errors.push("talentRequirements must be an array when set");
  }
  if (rule.cooldownModifiers != null) {
    if (!Array.isArray(rule.cooldownModifiers)) {
      errors.push("cooldownModifiers must be an array when set");
    } else {
      for (const [index, mod] of rule.cooldownModifiers.entries()) {
        if (!Number.isFinite(mod.talentId)) {
          errors.push(`cooldownModifiers[${index}]: talentId is required`);
        }
        if (mod.multiplier == null && mod.deltaMs == null) {
          errors.push(`cooldownModifiers[${index}]: multiplier or deltaMs required`);
        }
      }
    }
  }
  return errors;
}

export function validateAbilityCatalog(catalog: AbilityCatalog): string[] {
  const errors: string[] = [];
  if (!catalog.catalogVersion) errors.push("catalogVersion is required");
  if (!Array.isArray(catalog.rules)) {
    errors.push("rules must be an array");
    return errors;
  }
  const keys = new Set<string>();
  for (const [index, rule] of catalog.rules.entries()) {
    for (const err of validateAbilityRule(rule)) {
      errors.push(`rules[${index}]: ${err}`);
    }
    const key = `${rule.classSlug}:${rule.spellId}:${(rule.categories ?? []).join(",")}`;
    if (keys.has(key)) errors.push(`duplicate ability rule key: ${key}`);
    keys.add(key);
  }
  return errors;
}

export function resolveEffectiveCooldownMs(
  rule: AbilityRule,
  talentIds: ReadonlySet<number> = new Set(),
): number | null {
  if (rule.baseCooldownMs == null) return null;
  let cooldown = rule.baseCooldownMs;
  for (const mod of rule.cooldownModifiers ?? []) {
    if (!talentIds.has(mod.talentId)) continue;
    if (mod.multiplier != null) cooldown *= mod.multiplier;
    if (mod.deltaMs != null) cooldown += mod.deltaMs;
  }
  return Math.max(0, Math.round(cooldown));
}
