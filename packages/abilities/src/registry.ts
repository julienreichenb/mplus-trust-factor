import type {
  AbilityCatalog,
  AbilityCatalogLookup,
  AbilityCatalogUnsupportedReason,
  AbilityCategory,
  AbilityRole,
  AbilityRule,
  CatalogCoverageDiagnostics,
  CatalogSupportState,
  GetAbilityCatalogResult,
  LegacyAbilityCategory,
  ScoringAbilityCategory,
} from "./types.js";
import { getApplicableAbilityCategories } from "./applicability.js";
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

/** All registered rules for the current catalog pin (shared + class catalogs). */
export function getAllRegisteredRules(): AbilityRule[] {
  return [
    ...SHARED_CONSUMABLE_RULES,
    ...SHARED_RACIAL_RULES,
    ...Object.values(CLASS_RULES).flat(),
  ];
}

function emptyUnsupported(
  classSlug: string | null,
  specSlug: string | null,
  reason: AbilityCatalogUnsupportedReason,
  supportState?: CatalogSupportState,
): AbilityCatalog {
  return {
    version: CURRENT_CATALOG_VERSION,
    catalogVersion: "unsupported",
    classSlug,
    specSlug,
    supported: false,
    supportState,
    unsupportedReason: reason,
    rules: [...SHARED_CONSUMABLE_RULES],
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

function filterRulesForLookup(
  rules: AbilityRule[],
  classSlug: string,
  specSlug: string,
  role: AbilityRole | undefined,
  includeShared: boolean,
  includeRacials: boolean,
): AbilityRule[] {
  return rules.filter((rule) => {
    if (rule.classSlug == null) {
      if (rule.availability === "SHARED" && rule.category === "CONSUMABLE") return includeShared;
      if (rule.canonicalKey.startsWith("shared.racial.")) return includeRacials;
      return includeShared;
    }
    return ruleAppliesToSpec(rule, classSlug, specSlug) && ruleAppliesToRole(rule, role);
  });
}

function buildSupportedCatalog(
  classSlug: string,
  specSlug: string,
  supportState: CatalogSupportState,
  rules: AbilityRule[],
  catalogVersion: string,
  version = CURRENT_CATALOG_VERSION,
): AbilityCatalog {
  return {
    version,
    catalogVersion: catalogVersion,
    classSlug,
    specSlug,
    supported: true,
    supportState,
    rules,
  };
}

export function buildCatalog(rules: AbilityRule[]): AbilityCatalog {
  return {
    version: CURRENT_CATALOG_VERSION,
    catalogVersion: CURRENT_CATALOG_VERSION_ID,
    classSlug: null,
    specSlug: null,
    supported: true,
    rules,
  };
}

/** Full current Retail ability catalog (all rules). */
export const RETAIL_ABILITY_CATALOG: AbilityCatalog = buildCatalog(getAllRegisteredRules());

/** Historical catalog pins (current + TWW Warlock fixture slice). */
export function getCatalogByVersion(gameVersion: string): AbilityCatalog | null {
  const pin = HISTORICAL_CATALOG_VERSIONS.find((v) => v.gameVersion === gameVersion);
  if (!pin) return null;
  if (pin.gameVersion === CURRENT_CATALOG_VERSION.gameVersion) {
    return RETAIL_ABILITY_CATALOG;
  }
  return {
    version: pin,
    catalogVersion: `${pin.gameVersion}/${pin.seasonSlug ?? "unknown"}`,
    classSlug: null,
    specSlug: null,
    supported: true,
    rules: [...SHARED_CONSUMABLE_RULES, ...WARLOCK_RULES],
  };
}

/**
 * Detailed catalog resolution with explicit failure reasons.
 * Never falls back to Warlock for unknown specs.
 */
/**
 * Canonical catalog slug normalization used by resolveAbilityCatalog.
 * Trim + lowercase only — does not invent hyphenation or aliases.
 */
export function normalizeCatalogSlug(value: string | null | undefined): string | null {
  if (value == null) return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

export function resolveAbilityCatalog(lookup: AbilityCatalogLookup): GetAbilityCatalogResult {
  const classSlug = normalizeCatalogSlug(lookup.classSlug) ?? "";
  const specSlug = normalizeCatalogSlug(lookup.specSlug) ?? "";
  const role = lookup.role ?? undefined;
  const { gameVersion, includeShared = true, includeRacials = false } = lookup;

  if (!classSlug || !specSlug) {
    return {
      ok: false,
      reason: "CLASS_SPEC_UNKNOWN",
      classSlug: classSlug || "unknown",
      specSlug: specSlug || "unknown",
      role,
      gameVersion: gameVersion ?? undefined,
    };
  }

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
    return {
      ok: false,
      reason: "UNKNOWN_CLASS",
      classSlug,
      specSlug,
      role,
      gameVersion: gameVersion ?? undefined,
    };
  }

  const specDef = findSpecDefinition(classSlug, specSlug);
  if (!specDef) {
    return {
      ok: false,
      reason: "UNKNOWN_SPEC",
      classSlug,
      specSlug,
      role,
      gameVersion: gameVersion ?? undefined,
    };
  }

  if (specDef.supportState === "UNSUPPORTED" || classDef.supportState === "UNSUPPORTED") {
    return {
      ok: false,
      reason: "UNSUPPORTED_SPEC",
      classSlug,
      specSlug,
      role,
      gameVersion: gameVersion ?? undefined,
    };
  }

  const versioned = gameVersion ? getCatalogByVersion(gameVersion) : RETAIL_ABILITY_CATALOG;
  if (!versioned) {
    return {
      ok: false,
      reason: "UNSUPPORTED_VERSION",
      classSlug,
      specSlug,
      role,
      gameVersion: gameVersion ?? undefined,
    };
  }

  const rules = filterRulesForLookup(
    versioned.rules,
    classSlug,
    specSlug,
    role,
    includeShared,
    includeRacials,
  );

  return {
    ok: true,
    supportState: specDef.supportState,
    catalog: buildSupportedCatalog(
      classSlug,
      specSlug,
      specDef.supportState,
      rules,
      versioned.catalogVersion,
      versioned.version,
    ),
  };
}

/**
 * Resolve the ability catalog for a class/spec/role.
 * Returns a supported catalog slice or an explicit unsupported catalog (never Warlock fallback).
 */
export function getAbilityCatalog(lookup: AbilityCatalogLookup): AbilityCatalog {
  const resolved = resolveAbilityCatalog(lookup);
  if (resolved.ok) return resolved.catalog;

  const classSlug = normalizeCatalogSlug(lookup.classSlug);
  const specSlug = normalizeCatalogSlug(lookup.specSlug);
  const specDef = classSlug && specSlug ? findSpecDefinition(classSlug, specSlug) : undefined;

  return emptyUnsupported(
    classSlug,
    specSlug,
    resolved.reason,
    specDef?.supportState,
  );
}

export interface ResolveAbilityRuleOptions {
  spellId: number;
  classSlug?: string | null;
  specSlug?: string | null;
}

/** Spell IDs that resolve to a rule (primary, aliases, activation, triggered). */
export function ruleResolvableSpellIds(rule: AbilityRule): number[] {
  return [
    ...new Set(
      [
        ...rule.spellIds,
        ...(rule.aliases ?? []),
        ...(rule.activationSpellIds ?? []),
        ...(rule.activationBuffIds ?? []),
        ...(rule.triggeredEffectIds ?? []),
      ].filter((id) => id > 0),
    ),
  ].sort((a, b) => a - b);
}

export type AbilitySpellIdResolution =
  | {
      status: "matched";
      rule: AbilityRule;
      matchedSpellId: number;
    }
  | {
      status: "ambiguous";
      rules: AbilityRule[];
      matchedSpellId: number;
    }
  | {
      status: "unmatched";
      matchedSpellId: number;
    };

/**
 * Resolve one WCL spell/effect ID to a canonical AbilityRule.
 * Collisions are explicit: never silently pick the first of multiple matches.
 */
export function resolveAbilityRuleBySpellId(options: {
  spellId: number;
  classSlug?: string | null;
  specSlug?: string | null;
  rules?: readonly AbilityRule[];
}): AbilitySpellIdResolution {
  const { spellId } = options;
  const rules = resolveAbilityRule({
    spellId,
    classSlug: options.classSlug,
    specSlug: options.specSlug,
    rules: options.rules,
  });
  if (rules.length === 0) return { status: "unmatched", matchedSpellId: spellId };
  if (rules.length === 1) {
    return { status: "matched", rule: rules[0]!, matchedSpellId: spellId };
  }
  return {
    status: "ambiguous",
    rules: [...rules].sort((a, b) => a.canonicalKey.localeCompare(b.canonicalKey)),
    matchedSpellId: spellId,
  };
}

export function resolveAbilityRule(options: ResolveAbilityRuleOptions & {
  rules?: readonly AbilityRule[];
}): AbilityRule[] {
  const { spellId, classSlug, specSlug } = options;
  const pool = options.rules ?? RETAIL_ABILITY_CATALOG.rules;
  return pool.filter((rule) => {
    if (!ruleResolvableSpellIds(rule).includes(spellId)) return false;
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

/** Explicit list of class/spec catalogs currently registered in the Retail matrix. */
export function listSupportedCatalogs(): Array<{
  classSlug: string;
  specSlug: string;
  catalogVersion: string;
  supportState: CatalogSupportState;
}> {
  return RETAIL_CLASS_MATRIX.flatMap((cls) =>
    cls.specs
      .filter((spec) => spec.supportState !== "UNSUPPORTED")
      .map((spec) => ({
        classSlug: cls.slug,
        specSlug: spec.slug,
        catalogVersion: CURRENT_CATALOG_VERSION_ID,
        supportState: spec.supportState,
      })),
  ).sort((a, b) => `${a.classSlug}/${a.specSlug}`.localeCompare(`${b.classSlug}/${b.specSlug}`));
}

export function buildCatalogCoverageDiagnostics(lookup: AbilityCatalogLookup): CatalogCoverageDiagnostics {
  const catalog = getAbilityCatalog(lookup);
  const categoryCoverage = {} as Record<AbilityCategory, number>;
  const categories: AbilityCategory[] = [
    "INTERRUPT",
    "HARD_CC",
    "SOFT_CC",
    "DISPEL",
    "PURGE",
    "DEFENSIVE_MAJOR",
    "DEFENSIVE_MINOR",
    "IMMUNITY",
    "SELF_HEAL",
    "EXTERNAL_DEFENSIVE",
    "GROUP_UTILITY",
    "MOVEMENT_UTILITY",
    "BATTLE_REZ",
    "BLOODLUST",
    "CONSUMABLE",
    "OFFENSIVE_MAJOR",
    "OFFENSIVE_MINOR",
  ];
  for (const cat of categories) categoryCoverage[cat] = 0;
  for (const rule of catalog.rules) {
    const count = rule.spellIds.length + (rule.aliases?.length ?? 0);
    categoryCoverage[rule.category] = (categoryCoverage[rule.category] ?? 0) + count;
  }

  const applicableCategories =
    catalog.supported && lookup.classSlug && lookup.specSlug && lookup.role
      ? getApplicableAbilityCategories({
          classSlug: lookup.classSlug,
          specSlug: lookup.specSlug,
          role: lookup.role,
          gameVersion: lookup.gameVersion ?? undefined,
          includeRacials: lookup.includeRacials,
        })
      : undefined;

  return {
    classSlug: catalog.classSlug,
    specSlug: catalog.specSlug,
    supported: catalog.supported,
    supportState: catalog.supportState,
    catalogVersion: catalog.supported ? catalog.catalogVersion : null,
    unsupportedReason: catalog.unsupportedReason,
    categoryCoverage,
    registeredClassSpecs: listSupportedCatalogs().map((c) => `${c.classSlug}/${c.specSlug}`),
    applicableCategories,
  };
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

/** @deprecated Use expandScoringCategory — single compatibility alias. */
export const normalizeCategory = expandScoringCategory;

/**
 * Backward-compatible Warlock Demonology catalog for existing worker tests.
 * Shared consumables included so consumable lookups still succeed.
 */
export const WARLOCK_DEMONOLOGY_CATALOG: AbilityCatalog = getAbilityCatalog({
  classSlug: "warlock",
  specSlug: "demonology",
  role: "DPS",
  includeShared: true,
  includeRacials: false,
});
