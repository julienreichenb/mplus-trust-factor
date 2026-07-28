import type {
  AbilityCatalog,
  AbilityCatalogLookup,
  AbilityCategory,
  CatalogCoverageDiagnostics,
} from "./types.js";
import { PRIEST_HOLY_CATALOG } from "./catalogs/priest-holy.js";
import { WARLOCK_DEMONOLOGY_CATALOG } from "./catalogs/warlock-demonology.js";
import { WARRIOR_ARMS_CATALOG } from "./catalogs/warrior-arms.js";
import { WARRIOR_PROTECTION_CATALOG } from "./catalogs/warrior-protection.js";
import { SHARED_CONSUMABLE_RULES } from "./catalogs/shared.js";

function key(classSlug: string, specSlug: string): string {
  return `${classSlug.toLowerCase()}::${specSlug.toLowerCase()}`;
}

const REGISTRY = new Map<string, AbilityCatalog>([
  [key("warlock", "demonology"), WARLOCK_DEMONOLOGY_CATALOG],
  [key("warrior", "arms"), WARRIOR_ARMS_CATALOG],
  [key("warrior", "protection"), WARRIOR_PROTECTION_CATALOG],
  [key("priest", "holy"), PRIEST_HOLY_CATALOG],
]);

/** Explicit list of class/spec catalogs currently registered. */
export function listSupportedCatalogs(): Array<{ classSlug: string; specSlug: string; catalogVersion: string }> {
  return [...REGISTRY.values()]
    .filter((c) => c.supported && c.classSlug && c.specSlug)
    .map((c) => ({
      classSlug: c.classSlug!,
      specSlug: c.specSlug!,
      catalogVersion: c.catalogVersion,
    }))
    .sort((a, b) => `${a.classSlug}/${a.specSlug}`.localeCompare(`${b.classSlug}/${b.specSlug}`));
}

function emptyUnsupported(
  classSlug: string | null,
  specSlug: string | null,
  reason: AbilityCatalog["unsupportedReason"],
): AbilityCatalog {
  return {
    catalogVersion: "unsupported",
    classSlug,
    specSlug,
    supported: false,
    unsupportedReason: reason,
    rules: [...SHARED_CONSUMABLE_RULES],
  };
}

/**
 * Resolve the ability catalog for a class/spec/role.
 * Never falls back to another specialization's toolkit (e.g. Warlock for Mage).
 */
export function getAbilityCatalog(lookup: AbilityCatalogLookup): AbilityCatalog {
  const classSlug = lookup.classSlug?.trim().toLowerCase() || null;
  const specSlug = lookup.specSlug?.trim().toLowerCase() || null;

  if (!classSlug || !specSlug) {
    return emptyUnsupported(classSlug, specSlug, "CLASS_SPEC_UNKNOWN");
  }

  const found = REGISTRY.get(key(classSlug, specSlug));
  if (!found) {
    return emptyUnsupported(classSlug, specSlug, "ABILITY_CATALOG_UNSUPPORTED");
  }

  if (lookup.role) {
    const role = lookup.role;
    return {
      ...found,
      rules: found.rules.filter((r) => r.roles.length === 0 || r.roles.includes(role)),
    };
  }

  return found;
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
  ];
  for (const cat of categories) categoryCoverage[cat] = 0;
  for (const rule of catalog.rules) {
    categoryCoverage[rule.category] = (categoryCoverage[rule.category] ?? 0) + rule.spellIds.length;
  }

  return {
    classSlug: catalog.classSlug,
    specSlug: catalog.specSlug,
    supported: catalog.supported,
    catalogVersion: catalog.supported ? catalog.catalogVersion : null,
    unsupportedReason: catalog.unsupportedReason,
    categoryCoverage,
    registeredClassSpecs: listSupportedCatalogs().map((c) => `${c.classSlug}/${c.specSlug}`),
  };
}
