export type {
  AbilityAvailability,
  AbilityCatalog,
  AbilityCatalogLookup,
  AbilityCatalogVersion,
  AbilityCategory,
  AbilityDimensionTag,
  AbilityExternalMetadata,
  AbilityProvenance,
  AbilityRole,
  AbilityRule,
  ActivationEventType,
  ActivationSource,
  ApplicableCategoryResult,
  CatalogCoverageDiagnostics,
  CatalogCoverageReport,
  CatalogSupportState,
  CatalogValidationReport,
  GetAbilityCatalogResult,
  InterruptCapabilityProfile,
  LegacyAbilityCategory,
  ProvenanceSource,
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
  SAME_FIGHT_PARTY_CLASS_SLUGS,
  findClassDefinition,
  findSpecDefinition,
  findRetailSpecIdentityByBlizzardSpecId,
  normalizeRetailClassSlug,
  normalizeRetailSpecSlug,
  canonicalizeRetailClassSpecIdentity,
  canonicalRoleForClassSpec,
  roleForSpec,
} from "./catalog/classes-matrix.js";
export type {
  RetailSpecIdentity,
  CanonicalRetailClassSpecIdentity,
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
  resolveAbilityRuleBySpellId,
  ruleResolvableSpellIds,
} from "./registry.js";
export type { AbilitySpellIdResolution } from "./registry.js";

export {
  createStaticAbilityCatalogContext,
  createRulesAbilityCatalogContext,
  filterRulesForCatalogContext,
} from "./catalog-context.js";
export type {
  AbilityCatalogContext,
  AbilityCatalogContextIdentity,
  AbilityCatalogTopologyView,
} from "./catalog-context.js";

export { getActiveAbilityCatalogContext } from "./catalog-context-holder.js";

export {
  applicableCategories,
  effectiveKickCooldownMs,
  ruleMatchesCategory,
  rulesForCategory,
  rulesForSpell,
  spellIdsForCategory,
} from "./match.js";

export {
  defaultDimensionTagsForCategory,
  dimensionTagsForRule,
  isDigestRelevantRule,
  performanceCooldownRule,
  rule,
} from "./catalog/rule.js";

export { isSurvivalActiveHealRule } from "./survival/active-heal.js";

export {
  OFFENSIVE_COVERAGE_EXEMPTIONS,
  exemptionFor,
} from "./offensive/tooling/exemptions.js";

export {
  filterRulesByAvailability,
  getApplicableAbilityCategories,
  resolveAbilityCapability,
  resolveInterruptProfile,
  resolveUtilityAbilityCapabilities,
} from "./applicability.js";
export type {
  AbilityCapabilityResolution,
  AbilityCapabilityState,
  GetApplicableOptions,
} from "./applicability.js";

export {
  normalizeRaceSlug,
  raceCompatible,
  raceSlugFromBlizzardRaceId,
} from "./race.js";
export type { RaceEvidenceState } from "./race.js";

export { validateAbilityCatalog } from "./validation.js";
export { buildCoverageReport, formatCoverageReport } from "./coverage.js";
export {
  buildOffensiveCandidateCatalog,
  defaultOffensiveAdapters,
  type OffensiveBuildInput,
  type OffensiveCandidateCatalog,
  type OffensiveReviewReport,
} from "./offensive/build.js";
export {
  validateOffensiveCatalog,
  type OffensiveSpecValidationRow,
  type OffensiveValidationReport,
} from "./offensive/validate.js";
export {
  buildOffensiveCoverageMatrix,
  formatOffensiveCoverageReport,
  type OffensiveCoverageMatrix,
  type OffensiveCoverageSpecRow,
} from "./offensive/coverage.js";
export {
  classifyActivationSignal,
  openingEventTypesForRule,
  projectCanonicalActivations,
  projectOffensiveActivations,
  type ActivationGroupKeyMode,
  type ActivationSignalDisposition,
  type CanonicalOffensiveActivation,
  type OffensiveActivationEvent,
  type OffensiveActivationProjection,
} from "./offensive/activation.js";
export {
  isSurvivalActivationRule,
  projectSurvivalActivations,
  type CanonicalSurvivalActivation,
  type SurvivalActivationEvent,
  type SurvivalActivationProjection,
} from "./survival/activation.js";
export {
  blizzardGameDataAdapter,
  createWclObservedAdapter,
  existingCatalogAdapter,
  loadAuthoritativeBlizzardPlayableMatrix,
  simcAdvisoryAdapter,
  wclObservedAdapter,
} from "./offensive/sources/index.js";
export type {
  CatalogReviewStatus,
  OffensiveCandidateCooldownCategory,
  OffensiveCandidateProposal,
} from "./offensive/sources/types.js";
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

export type {
  AbilitySpellBindingCandidate,
  AbilitySpellBindingRole,
  CatalogDiffEntry,
  CatalogDiffStatus,
  CatalogRefreshCandidate,
  CatalogRefreshCoverageReport,
  CatalogRefreshReport,
  CatalogRelevance,
  ExternalAbilityCandidate,
  ExternalSourceSnapshot,
  ObservationalEvidenceContract,
  SnapshotDatasetKind,
  SourceObservation,
} from "./refresh/types.js";

export { runShadowCatalogRefresh, formatShadowRefreshSummary } from "./refresh/pipeline.js";
export {
  collapseRacialSpellVariants,
  classifyRacialVariantMember,
  racialConceptualGroupKey,
  spellBuildIsCurrentForTarget,
  type RacialVariantValidity,
  type RacialVariantCollapseReport,
} from "./refresh/racial-variants.js";
export {
  importBlizzardRefreshSnapshot,
  createBlizzardRefreshAdapter,
} from "./refresh/sources/blizzard.js";
export { importSimcSpellQuerySnapshot, createSimcRefreshAdapter, type SimcSpellQueryExport } from "./refresh/sources/simc.js";
export { projectCurrentRuleBindings, compareBindingRoles } from "./refresh/bindings.js";
export { matchCandidatesToCurrent } from "./refresh/match.js";
export { validateRefreshCandidates, validateRefreshSnapshots } from "./refresh/validate.js";
export { formatShadowCoverageReport } from "./refresh/coverage.js";
export {
  buildReviewImportPlan,
  suggestCanonicalKey,
  suggestCuratedCanonicalKey,
  resolveCanonicalKeyCollision,
  normalizeAbilityNameSlug,
  isValidCanonicalKeyFormat,
  assertPinnedReportForImport,
  CANONICAL_KEY_PATTERN,
  ABILITY_CATALOG_REVIEW_PLAN_SCHEMA_VERSION,
  type ReviewImportPlan,
  type ReviewImportItemDraft,
  type TopologyClassificationLike,
  type AbilityCatalogReviewItemKind,
} from "./refresh/review/import-plan.js";
export {
  MPLUS_RELEVANCE_STATES,
  stableAbilityIdentity,
  resolveMplusRelevance,
  filterReviewImportItems,
  collectStableIdentities,
  type MplusRelevance,
  type MplusRelevanceContext,
  type StableAbilityIdentityInput,
} from "./refresh/mplus-relevance.js";
export {
  prefillCuratedDraftDefaults,
  mergeCuratedDraftInput,
  candidateEvidenceFromDiffEntry,
  candidateMetadataForDiff,
  inferAvailabilityFromReviewContext,
  inferSourceOwnershipFromOwnershipKind,
  provenanceFromRefreshEvidence,
  type ReviewItemDraftPrefillInput,
  type DraftPrefillMergeMode,
  type CatalogDiffCandidateMetadata,
} from "./refresh/review/draft-prefill.js";
export {
  applyBusinessMetadataToCuratedDraft,
  applyBusinessMetadataToReviewDraft,
  dimensionTagsForBusinessMetadataEdit,
  dimensionTagsForReviewDraftEdit,
  type AbilityBusinessMetadataPatch,
} from "./refresh/review/business-metadata.js";
export {
  validateCuratedDraftRule,
  DRAFT_ABILITY_CATEGORIES,
  DRAFT_DIMENSION_TAGS,
  DRAFT_AVAILABILITIES,
  DRAFT_SOURCE_OWNERSHIPS,
  DRAFT_BINDING_ROLES,
  type CuratedDraftRuleInput,
  type DraftBinding,
  type DraftValidationIssue,
  type DraftValidationResult,
  type AbilitySpellBindingRole as DraftAbilitySpellBindingRole,
} from "./refresh/review/draft-validation.js";
