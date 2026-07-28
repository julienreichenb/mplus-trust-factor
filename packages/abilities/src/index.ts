export type {
  AbilityCatalog,
  AbilityCatalogLookup,
  AbilityCategory,
  AbilityRole,
  AbilityRule,
  CatalogCoverageDiagnostics,
  LegacyAbilityCategory,
  SourceOwnership,
} from "./types.js";
export {
  applicableCategories,
  effectiveKickCooldownMs,
  normalizeCategory,
  ruleMatchesCategory,
  rulesForCategory,
  rulesForSpell,
  spellIdsForCategory,
} from "./match.js";
export { SHARED_CONSUMABLE_RULES, withSharedRules } from "./catalogs/shared.js";
export { WARLOCK_DEMONOLOGY_CATALOG } from "./catalogs/warlock-demonology.js";
export { WARRIOR_ARMS_CATALOG } from "./catalogs/warrior-arms.js";
export { WARRIOR_PROTECTION_CATALOG } from "./catalogs/warrior-protection.js";
export { PRIEST_HOLY_CATALOG } from "./catalogs/priest-holy.js";
export {
  buildCatalogCoverageDiagnostics,
  getAbilityCatalog,
  listSupportedCatalogs,
} from "./registry.js";
