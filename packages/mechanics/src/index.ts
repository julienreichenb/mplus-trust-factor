export type {
  MechanicCatalog,
  MechanicRule,
  MechanicRuleType,
  Role,
} from "./types.js";
export {
  MECHANIC_RULE_TYPES,
  createEmptyCatalog,
  validateMechanicRule,
  validateMechanicCatalog,
} from "./types.js";
export { matchMechanicRules, classifyDamageEvent } from "./match.js";
export type { MechanicMatchQuery, DamageClassification } from "./match.js";
export { MINIMAL_SEED_CATALOG } from "./seed-catalog.js";

export type {
  AbilityCategory,
  AbilityCatalog,
  AbilityCooldownModifier,
  AbilityRule,
} from "./ability-types.js";
export {
  ABILITY_CATEGORIES,
  createEmptyAbilityCatalog,
  validateAbilityRule,
  validateAbilityCatalog,
  resolveEffectiveCooldownMs,
} from "./ability-types.js";

export type {
  ScoringMechanicCatalog,
  ScoringMechanicRule,
  ScoringMechanicSeverity,
} from "./scoring-mechanic-types.js";
export {
  SCORING_MECHANIC_SEVERITIES,
  createEmptyScoringMechanicCatalog,
  validateScoringMechanicRule,
  validateScoringMechanicCatalog,
  findScoringMechanicRules,
  isAvoidableAbility,
} from "./scoring-mechanic-types.js";

export type { SeasonDungeonSet } from "./season-dungeons.js";
export {
  MIDNIGHT_S1_DUNGEON_SLUGS,
  MIDNIGHT_S1_SEASON,
  isPlaceholderSeasonSlug,
  resolveCanonicalScoringSeasonSlug,
  resolveSeasonDungeonSet,
} from "./season-dungeons.js";

export {
  loadAbilityCatalogFromObject,
  loadScoringMechanicCatalogFromObject,
  loadSeedAbilityCatalog,
  loadSeedScoringMechanicCatalog,
  indexAbilityRulesBySpellId,
  indexScoringMechanicsByAbilityId,
} from "./catalog-loader.js";
export { SEED_ABILITY_CATALOG } from "./catalogs/ability-rules.seed.js";
export { SEED_SCORING_MECHANIC_CATALOG } from "./catalogs/scoring-mechanic-rules.seed.js";

export type {
  ExtractRawFactsInput,
  ExtractedSurvivalCounts,
  ExtractedUtilityCounts,
  GroupSupportEvidenceMode,
  RawAuraLike,
  RawCastLike,
  RawDamageTakenLike,
  RawDeathLike,
  RawDispelLike,
  RawHealingLike,
  RawInterruptLike,
} from "./raw-facts.js";
export { extractSurvivalCounts, extractUtilityCounts } from "./raw-facts.js";
export {
  hasAbilityCategory,
  estimateAvailableDefensiveUses,
} from "./defensive-capacity.js";

export type {
  ResolvedInterrupt,
  UtilityCapability,
  UtilityContributorKey,
} from "./utility-capability.js";
export {
  UTILITY_CONTRIBUTOR_KEYS,
  availableWindows,
  resolveInterruptAbility,
  resolveUtilityCapability,
} from "./utility-capability.js";

import type { MechanicRule } from "./types.js";
import { validateMechanicRule } from "./types.js";

/** @deprecated Prefer MechanicRule + validateMechanicRule */
export type MechanicRuleDraft = MechanicRule;

/** Catalog abstractions — concrete season rules owned with Agent 4. */
export function validateMechanicRuleDraft(rule: MechanicRuleDraft): string[] {
  return validateMechanicRule(rule);
}
