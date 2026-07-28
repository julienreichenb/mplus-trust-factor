export type {
  AbilityAvailability,
  AbilityCatalog,
  AbilityCatalogVersion,
  AbilityCategory,
  AbilityExternalMetadata,
  AbilityProvenance,
  AbilityRole,
  AbilityRule,
  ApplicableCategoryResult,
  CatalogCoverageReport,
  CatalogSupportState,
  CatalogValidationReport,
  GetAbilityCatalogResult,
  LegacyAbilityCategory,
  RetailClassDefinition,
  RetailSpecDefinition,
  ScoringAbilityCategory,
  SourceOwnership,
  SpecCoverageRow,
  ValidationIssue,
} from "./types.js";

export {
  CATALOG_GAME_VERSION,
  CATALOG_GENERATED_AT,
  CATALOG_SEASON_SLUG,
  CATALOG_SOURCE_SNAPSHOT,
  CATALOG_VERIFIED_AT,
  CURRENT_CATALOG_VERSION,
  CURRENT_CATALOG_VERSION_ID,
  HISTORICAL_CATALOG_VERSIONS,
} from "./version.js";

export {
  RETAIL_CLASS_MATRIX,
  findClassDefinition,
  findSpecDefinition,
} from "./catalog/classes-matrix.js";

export {
  RETAIL_ABILITY_CATALOG,
  WARLOCK_DEMONOLOGY_CATALOG,
  buildCatalog,
  expandScoringCategory,
  getAbilityCatalog,
  getAllRegisteredRules,
  getCatalogByVersion,
  getRetailClassMatrix,
  LEGACY_CATEGORY_MAP,
  listSupportedClassSlugs,
  resolveAbilityRule,
} from "./registry.js";

export {
  effectiveKickCooldownMs,
  rulesForCategory,
  rulesForSpell,
  spellIdsForCategory,
} from "./match.js";

export {
  filterRulesByAvailability,
  getApplicableAbilityCategories,
} from "./applicability.js";

export { validateAbilityCatalog } from "./validation.js";
export { buildCoverageReport, formatCoverageReport } from "./coverage.js";
export {
  buildExternalMetadata,
  enrichRuleExternalMetadata,
  wowheadSpellUrl,
} from "./external-metadata.js";

export {
  queryAdminAbilityCatalog,
  type AdminAbilityCatalogQuery,
  type AdminAbilityCatalogResponse,
  type AdminAbilityEntry,
  type AdminSectionKind,
} from "./admin-query.js";
