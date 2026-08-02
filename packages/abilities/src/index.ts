export type {
  AbilityAvailability,
  AbilityCatalog,
  AbilityCatalogLookup,
  AbilityCatalogVersion,
  AbilityCategory,
  AbilityExternalMetadata,
  AbilityProvenance,
  AbilityRole,
  AbilityRule,
  ApplicableCategoryResult,
  CatalogCoverageDiagnostics,
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
  roleForSpec,
} from "./catalog/classes-matrix.js";

export {
  RETAIL_ABILITY_CATALOG,
  WARLOCK_DEMONOLOGY_CATALOG,
  buildCatalog,
  buildCatalogCoverageDiagnostics,
  expandScoringCategory,
  getAbilityCatalog,
  getAllRegisteredRules,
  getCatalogByVersion,
  getRetailClassMatrix,
  LEGACY_CATEGORY_MAP,
  listSupportedCatalogs,
  listSupportedClassSlugs,
  normalizeCatalogSlug,
  normalizeCategory,
  resolveAbilityCatalog,
  resolveAbilityRule,
} from "./registry.js";

export {
  applicableCategories,
  effectiveKickCooldownMs,
  ruleMatchesCategory,
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
  WOW_ICON_CDN_BASE,
  WOW_ICON_CDN_ORIGIN,
  WOW_ICON_FALLBACK_DATA_URI,
  normalizeWowIconName,
  wowIconSrc,
  wowIconUrl,
} from "./wow-icons.js";

export {
  queryAdminAbilityCatalog,
  type AdminAbilityCatalogQuery,
  type AdminAbilityCatalogResponse,
  type AdminAbilityEntry,
  type AdminSectionKind,
} from "./admin-query.js";
