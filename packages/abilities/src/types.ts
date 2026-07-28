/** Survival / Utility ability taxonomy consumed by scorers (Agent 31). */
export type AbilityCategory =
  | "INTERRUPT"
  | "HARD_CC"
  | "SOFT_CC"
  | "DISPEL"
  | "PURGE"
  | "DEFENSIVE_MAJOR"
  | "DEFENSIVE_MINOR"
  | "IMMUNITY"
  | "SELF_HEAL"
  | "EXTERNAL_DEFENSIVE"
  | "GROUP_UTILITY"
  | "MOVEMENT_UTILITY"
  | "BATTLE_REZ"
  | "BLOODLUST"
  | "CONSUMABLE";

/**
 * Legacy category names used by Wave 4 combat-metrics.
 * Prefer AbilityCategory; match helpers accept both via LEGACY_CATEGORY_MAP.
 */
export type LegacyAbilityCategory =
  | "interrupt"
  | "crowd_control"
  | "personal_defensive"
  | "self_heal"
  | "health_potion"
  | "group_support"
  | "defensive_dispel"
  | "offensive_dispel";

export type ScoringAbilityCategory = AbilityCategory | LegacyAbilityCategory;

export type AbilityRole = "DPS" | "TANK" | "HEALER";

export type SourceOwnership = "PLAYER" | "PET" | "GUARDIAN" | "ANY_OWNED";

export type AbilityAvailability =
  | "BASELINE"
  | "TALENT"
  | "PET_DEPENDENT"
  | "FORM_DEPENDENT"
  | "CHOICE_NODE"
  | "SHARED";

export type CatalogSupportState = "SUPPORTED" | "PARTIAL" | "UNSUPPORTED" | "UNCERTAIN";

export type ProvenanceSource = "BLIZZARD_API" | "CURATED_OVERRIDE" | "REPOSITORY_FIXTURE";

export interface AbilityProvenance {
  source: ProvenanceSource;
  sourceId?: string;
  verifiedAt: string;
  gameVersion: string;
  notes?: string;
  certainty?: "verified" | "uncertain" | "deprecated";
}

export interface AbilityCatalogVersion {
  gameVersion: string;
  seasonSlug?: string;
  generatedAt: string;
  sourceSnapshot?: string;
}

export interface AbilityRule {
  /** Stable logical key, e.g. `warlock.interrupt.spell-lock`. */
  canonicalKey: string;
  /** Display name for admin / tooling. */
  name: string;
  /** Primary and replacement spell IDs for one logical ability. */
  spellIds: number[];
  classSlug: string | null;
  specSlugs: string[];
  roles: AbilityRole[];
  category: AbilityCategory;
  sourceOwnership: SourceOwnership;
  sharedAcrossSpecs: boolean;
  availability: AbilityAvailability;
  cooldownSeconds?: number;
  requiresSuccessfulTarget?: boolean;
  /** canonicalKey of the ability this replaces. */
  replacementFor?: string;
  /** Additional spell IDs that resolve to this rule (aliases / cast variants). */
  aliases?: number[];
  provenance: AbilityProvenance;
  /** Optional curator-facing support hint. */
  supportCertainty?: "verified" | "uncertain" | "deprecated";
  /** @deprecated Legacy fixture field — prefer availability/sourceOwnership. */
  petRequirement?: string;
  talentRequirements?: number[];
  validFromBuild?: string;
  validToBuild?: string;
}

export type AbilityCatalogUnsupportedReason =
  | "ABILITY_CATALOG_UNSUPPORTED"
  | "CLASS_SPEC_UNKNOWN"
  | "UNKNOWN_CLASS"
  | "UNKNOWN_SPEC"
  | "UNSUPPORTED_SPEC"
  | "UNSUPPORTED_VERSION";

export interface AbilityCatalog {
  version: AbilityCatalogVersion;
  /** Convenience mirror of version identity for older callers. */
  catalogVersion: string;
  classSlug: string | null;
  specSlug: string | null;
  /** False when no class/spec catalog is registered for the lookup. */
  supported: boolean;
  supportState?: CatalogSupportState;
  unsupportedReason?: AbilityCatalogUnsupportedReason;
  rules: AbilityRule[];
}

export interface AbilityCatalogLookup {
  classSlug: string | null | undefined;
  specSlug?: string | null;
  role?: AbilityRole | null;
  gameVersion?: string | null;
  includeShared?: boolean;
  includeRacials?: boolean;
}

export interface RetailSpecDefinition {
  slug: string;
  name: string;
  role: AbilityRole;
  supportState: CatalogSupportState;
  notes?: string;
}

export interface RetailClassDefinition {
  slug: string;
  name: string;
  supportState: CatalogSupportState;
  specs: RetailSpecDefinition[];
  notes?: string;
}

export interface AbilityExternalMetadata {
  spellId: number;
  wowheadUrl: string | null;
  iconUrl: string | null;
  tooltipAvailable: boolean;
  metadataSource: "WOWHEAD" | "BLIZZARD" | "FALLBACK";
}

export type GetAbilityCatalogResult =
  | { ok: true; catalog: AbilityCatalog; supportState: CatalogSupportState }
  | {
      ok: false;
      reason: AbilityCatalogUnsupportedReason;
      classSlug: string;
      specSlug: string;
      role?: AbilityRole;
      gameVersion?: string;
    };

export interface ApplicableCategoryResult {
  category: AbilityCategory;
  state: "applicable" | "not_applicable" | "uncertain";
  reason?: string;
  rules: AbilityRule[];
}

export interface CatalogCoverageDiagnostics {
  classSlug: string | null;
  specSlug: string | null;
  supported: boolean;
  supportState?: CatalogSupportState;
  catalogVersion: string | null;
  unsupportedReason?: string;
  categoryCoverage: Record<AbilityCategory, number>;
  registeredClassSpecs: string[];
  applicableCategories?: ApplicableCategoryResult[];
}

export type ValidationSeverity = "error" | "warning";

export interface ValidationIssue {
  severity: ValidationSeverity;
  code: string;
  message: string;
  canonicalKey?: string;
  spellId?: number;
  classSlug?: string;
  specSlug?: string;
}

export interface CatalogValidationReport {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  generatedAt: string;
}

export interface SpecCoverageRow {
  classSlug: string;
  className: string;
  specSlug: string;
  specName: string;
  role: AbilityRole;
  supportState: CatalogSupportState;
  categories: AbilityCategory[];
  ruleCount: number;
  talentDependentCount: number;
  petDependentCount: number;
  uncertainCount: number;
  missingCategories: AbilityCategory[];
}

export interface CatalogCoverageReport {
  version: AbilityCatalogVersion;
  classes: Array<{
    classSlug: string;
    className: string;
    supportState: CatalogSupportState;
    specCount: number;
    supportedSpecCount: number;
    ruleCount: number;
  }>;
  specs: SpecCoverageRow[];
  totals: {
    classes: number;
    specs: number;
    canonicalRules: number;
    spellIds: number;
    aliases: number;
    talentDependent: number;
    petDependent: number;
    uncertain: number;
  };
  generatedAt: string;
}
