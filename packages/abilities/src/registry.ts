import type {
  AbilityCatalog,
  AbilityCategory,
  AbilityRole,
  AbilityRule,
  GetAbilityCatalogResult,
  LegacyAbilityCategory,
  ScoringAbilityCategory,
} from "./types.js";
import { RETAIL_CLASS_MATRIX, findClassDefinition, findSpecDefinition } from "./catalog/classes-matrix.js";
import { DEATH_KNIGHT_RULES } from "./catalog/classes/death-knight.js";
import { DEMON_HUNTER_RULES } from "./catalog/classes/demon-hunter.js";
import { DRUID_RULES } from "./catalog/classes/druid.js";
import { EVOKER_RULES } from "./catalog/classes/evoker.js";
import { HUNTER_RULES } from "./catalog/classes/hunter.js";
import { MAGE_RULES } from "./catalog/classes/mage.js";
import { MONK_RULES } from "./catalog/classes/monk.js";
import { PALADIN_RULES } from "./catalog/classes/paladin.js";
import { PRIEST_RULES } from "./catalog/classes/priest.js";
import { ROGUE_RULES } from "./catalog/classes/rogue.js";
import { SHAMAN_RULES } from "./catalog/classes/shaman.js";
import { WARLOCK_RULES } from "./catalog/classes/warlock.js";
import { WARRIOR_RULES } from "./catalog/classes/warrior.js";
import { SHARED_CONSUMABLE_RULES } from "./catalog/shared/consumables.js";
import { SHARED_RACIAL_RULES } from "./catalog/shared/racials.js";
import {
  CURRENT_CATALOG_VERSION,
  CURRENT_CATALOG_VERSION_ID,
  HISTORICAL_CATALOG_VERSIONS,
} from "./version.js";

const CLASS_RULES: Record<string, AbilityRule[]> = {
  "death-knight": DEATH_KNIGHT_RULES,
  "demon-hunter": DEMON_HUNTER_RULES,
  druid: DRUID_RULES,
  evoker: EVOKER_RULES,
  hunter: HUNTER_RULES,
  mage: MAGE_RULES,
  monk: MONK_RULES,
  paladin: PALADIN_RULES,
  priest: PRIEST_RULES,
  rogue: ROGUE_RULES,
  shaman: SHAMAN_RULES,
  warlock: WARLOCK_RULES,
  warrior: WARRIOR_RULES,
};

/** All registered rules for the current catalog pin (shared + classes). */
export function getAllRegisteredRules(): AbilityRule[] {
  return [
    ...SHARED_CONSUMABLE_RULES,
    ...SHARED_RACIAL_RULES,
    ...Object.values(CLASS_RULES).flat(),
  ];
}

export function buildCatalog(rules: AbilityRule[]): AbilityCatalog {
  return {
    version: CURRENT_CATALOG_VERSION,
    catalogVersion: CURRENT_CATALOG_VERSION_ID,
    rules,
  };
}

/** Full current Retail ability catalog. */
export const RETAIL_ABILITY_CATALOG: AbilityCatalog = buildCatalog(getAllRegisteredRules());

/** Historical catalog pins (current + TWW Warlock fixture slice). */
export function getCatalogByVersion(gameVersion: string): AbilityCatalog | null {
  const pin = HISTORICAL_CATALOG_VERSIONS.find((v) => v.gameVersion === gameVersion);
  if (!pin) return null;
  if (pin.gameVersion === CURRENT_CATALOG_VERSION.gameVersion) {
    return RETAIL_ABILITY_CATALOG;
  }
  // Historical TWW pin: Warlock rules + shared consumables only (reproducibility).
  return {
    version: pin,
    catalogVersion: `${pin.gameVersion}/${pin.seasonSlug ?? "unknown"}`,
    rules: [...SHARED_CONSUMABLE_RULES, ...WARLOCK_RULES],
  };
}

function ruleAppliesToSpec(rule: AbilityRule, classSlug: string, specSlug: string): boolean {
  if (rule.classSlug == null) return true;
  if (rule.classSlug !== classSlug) return false;
  if (rule.specSlugs.length === 0) return true;
  return rule.specSlugs.includes(specSlug);
}

function ruleAppliesToRole(rule: AbilityRule, role?: AbilityRole): boolean {
  if (!role) return true;
  return rule.roles.includes(role);
}

export interface GetAbilityCatalogOptions {
  classSlug: string;
  specSlug: string;
  role?: AbilityRole;
  gameVersion?: string;
  includeShared?: boolean;
  includeRacials?: boolean;
}

/**
 * Resolve a class/spec catalog slice. Never falls back to Warlock for unknown specs.
 */
export function getAbilityCatalog(options: GetAbilityCatalogOptions): GetAbilityCatalogResult {
  const { classSlug, specSlug, role, gameVersion, includeShared = true, includeRacials = false } = options;

  if (gameVersion && !HISTORICAL_CATALOG_VERSIONS.some((v) => v.gameVersion === gameVersion)) {
    return {
      ok: false,
      reason: "UNSUPPORTED_VERSION",
      classSlug,
      specSlug,
      role,
      gameVersion,
    };
  }

  const classDef = findClassDefinition(classSlug);
  if (!classDef) {
    return { ok: false, reason: "UNKNOWN_CLASS", classSlug, specSlug, role, gameVersion };
  }

  const specDef = findSpecDefinition(classSlug, specSlug);
  if (!specDef) {
    return { ok: false, reason: "UNKNOWN_SPEC", classSlug, specSlug, role, gameVersion };
  }

  if (specDef.supportState === "UNSUPPORTED" || classDef.supportState === "UNSUPPORTED") {
    return { ok: false, reason: "UNSUPPORTED_SPEC", classSlug, specSlug, role, gameVersion };
  }

  const versioned = gameVersion ? getCatalogByVersion(gameVersion) : RETAIL_ABILITY_CATALOG;
  if (!versioned) {
    return {
      ok: false,
      reason: "UNSUPPORTED_VERSION",
      classSlug,
      specSlug,
      role,
      gameVersion,
    };
  }

  const classRules = versioned.rules.filter((r) => {
    if (r.classSlug == null) {
      if (r.availability === "SHARED" && r.category === "CONSUMABLE") return includeShared;
      if (r.canonicalKey.startsWith("shared.racial.")) return includeRacials;
      return includeShared;
    }
    return ruleAppliesToSpec(r, classSlug, specSlug) && ruleAppliesToRole(r, role);
  });

  return {
    ok: true,
    supportState: specDef.supportState,
    catalog: {
      version: versioned.version,
      catalogVersion: versioned.catalogVersion,
      rules: classRules,
    },
  };
}

export interface ResolveAbilityRuleOptions {
  spellId: number;
  classSlug?: string | null;
  specSlug?: string | null;
}

export function resolveAbilityRule(options: ResolveAbilityRuleOptions): AbilityRule[] {
  const { spellId, classSlug, specSlug } = options;
  return RETAIL_ABILITY_CATALOG.rules.filter((rule) => {
    const ids = new Set([...rule.spellIds, ...(rule.aliases ?? [])]);
    if (!ids.has(spellId)) return false;
    if (classSlug && rule.classSlug != null && rule.classSlug !== classSlug) return false;
    if (specSlug && rule.classSlug != null && rule.specSlugs.length > 0 && !rule.specSlugs.includes(specSlug)) {
      return false;
    }
    return true;
  });
}

export function listSupportedClassSlugs(): string[] {
  return RETAIL_CLASS_MATRIX.map((c) => c.slug);
}

export function getRetailClassMatrix() {
  return RETAIL_CLASS_MATRIX;
}

/** Maps legacy combat-metrics category names onto the generic taxonomy. */
export const LEGACY_CATEGORY_MAP: Record<LegacyAbilityCategory, AbilityCategory[]> = {
  interrupt: ["INTERRUPT"],
  crowd_control: ["HARD_CC", "SOFT_CC"],
  personal_defensive: ["DEFENSIVE_MAJOR", "DEFENSIVE_MINOR", "IMMUNITY"],
  self_heal: ["SELF_HEAL"],
  health_potion: ["CONSUMABLE"],
  group_support: ["GROUP_UTILITY", "EXTERNAL_DEFENSIVE", "MOVEMENT_UTILITY", "BATTLE_REZ", "BLOODLUST"],
  defensive_dispel: ["DISPEL"],
  offensive_dispel: ["PURGE"],
};

export function expandScoringCategory(category: ScoringAbilityCategory): AbilityCategory[] {
  if (category in LEGACY_CATEGORY_MAP) {
    return LEGACY_CATEGORY_MAP[category as LegacyAbilityCategory];
  }
  return [category as AbilityCategory];
}

/**
 * Backward-compatible Warlock Demonology catalog for existing worker tests.
 * Shared consumables included so health_potion lookups still succeed with classSlug=warlock.
 */
export const WARLOCK_DEMONOLOGY_CATALOG: AbilityCatalog = (() => {
  const result = getAbilityCatalog({
    classSlug: "warlock",
    specSlug: "demonology",
    role: "DPS",
    includeShared: true,
    includeRacials: false,
  });
  if (!result.ok) {
    throw new Error("Warlock Demonology catalog failed to resolve");
  }
  return result.catalog;
})();
