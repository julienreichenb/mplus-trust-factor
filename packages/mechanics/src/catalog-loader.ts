import {
  type AbilityCatalog,
  type AbilityRule,
  validateAbilityCatalog,
} from "./ability-types.js";
import {
  type ScoringMechanicCatalog,
  type ScoringMechanicRule,
  validateScoringMechanicCatalog,
} from "./scoring-mechanic-types.js";
import { SEED_ABILITY_CATALOG } from "./catalogs/ability-rules.seed.js";
import { SEED_SCORING_MECHANIC_CATALOG } from "./catalogs/scoring-mechanic-rules.seed.js";

export function loadAbilityCatalogFromObject(raw: unknown): AbilityCatalog {
  const catalog = raw as AbilityCatalog;
  const errors = validateAbilityCatalog(catalog);
  if (errors.length > 0) {
    throw new Error(`Invalid ability catalog: ${errors.join("; ")}`);
  }
  return catalog;
}

export function loadScoringMechanicCatalogFromObject(raw: unknown): ScoringMechanicCatalog {
  const catalog = raw as ScoringMechanicCatalog;
  const errors = validateScoringMechanicCatalog(catalog);
  if (errors.length > 0) {
    throw new Error(`Invalid scoring mechanic catalog: ${errors.join("; ")}`);
  }
  return catalog;
}

/** Load the bounded Wave 4 seed ability catalog (Warlock Demonology + shared potions). */
export function loadSeedAbilityCatalog(): AbilityCatalog {
  return loadAbilityCatalogFromObject(SEED_ABILITY_CATALOG);
}

/** Load the bounded Wave 4 seed scoring-mechanic catalog. */
export function loadSeedScoringMechanicCatalog(): ScoringMechanicCatalog {
  return loadScoringMechanicCatalogFromObject(SEED_SCORING_MECHANIC_CATALOG);
}

export function indexAbilityRulesBySpellId(catalog: AbilityCatalog): Map<number, AbilityRule[]> {
  const map = new Map<number, AbilityRule[]>();
  for (const rule of catalog.rules) {
    const existing = map.get(rule.spellId) ?? [];
    existing.push(rule);
    map.set(rule.spellId, existing);
  }
  return map;
}

export function indexScoringMechanicsByAbilityId(
  catalog: ScoringMechanicCatalog,
): Map<number, ScoringMechanicRule[]> {
  const map = new Map<number, ScoringMechanicRule[]>();
  for (const rule of catalog.rules) {
    const existing = map.get(rule.abilityId) ?? [];
    existing.push(rule);
    map.set(rule.abilityId, existing);
  }
  return map;
}
