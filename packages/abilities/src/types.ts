/** Survival / Utility / Performance ability taxonomy consumed by scorers and digests. */
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
  | "CONSUMABLE"
  /** Performance personal offensive cooldowns (mirror DEFENSIVE_MAJOR/MINOR). */
  | "OFFENSIVE_MAJOR"
  | "OFFENSIVE_MINOR";

/**
 * Dimension-neutral tags for combat-digest retention (not scoring).
 * An ability may carry one or more tags spanning Performance / Survival / Utility.
 */
export type AbilityDimensionTag =
  | "PERFORMANCE_OFFENSIVE_COOLDOWN"
  | "SURVIVAL_PERSONAL_DEFENSIVE"
  | "SURVIVAL_RECOVERY"
  | "UTILITY_INTERRUPT"
  | "UTILITY_DISPEL"
  | "UTILITY_CROWD_CONTROL"
  | "UTILITY_EXTERNAL"
  | "UTILITY_COMBAT_RES";

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

/**
 * Interrupt capability profile for Utility opportunity normalization.
 * Derived from catalog metadata — never a per-spec score bonus.
 */
export type InterruptCapabilityProfile =
  | "STANDARD"
  | "CONSTRAINED_CONTROL"
  | "LONG_COOLDOWN"
  | "PET_DEPENDENT";

export type CatalogSupportState = "SUPPORTED" | "PARTIAL" | "UNSUPPORTED" | "UNCERTAIN";

export type ProvenanceSource =
  | "BLIZZARD_API"
  | "CURATED_OVERRIDE"
  | "REPOSITORY_FIXTURE"
  | "WCL_OBSERVED"
  | "SIMC_ADVISORY";

/** WCL-style event types that may signal one canonical activation (any dimension). */
export type ActivationEventType =
  | "begincast"
  | "cast"
  | "applybuff"
  | "refreshbuff"
  | "removebuff"
  | "summon"
  | "applydebuff"
  | "refreshdebuff"
  | "empowerstart"
  | "empowerend";

/**
 * How the player intentionally starts an activation window.
 * Shared across Performance / Survival / Utility (e.g. pet cast, item on-use).
 */
export type ActivationSource =
  | "PLAYER_CAST"
  | "PLAYER_BUFF"
  | "PLAYER_EMPOWERED_CAST"
  | "OWNED_ACTOR_CAST"
  | "ITEM_CAST";

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
  /** Display name for admin / tooling (`canonicalName` in authoring docs). */
  name: string;
  /** Primary and replacement spell IDs for one logical ability (`primarySpellId` = spellIds[0]). */
  spellIds: number[];
  /**
   * Optional Wow icon file stem (CDN identifier), with or without extension.
   * Presentation only — used to build approved zamimg icon URLs.
   */
  iconName?: string | null;
  classSlug: string | null;
  specSlugs: string[];
  roles: AbilityRole[];
  category: AbilityCategory;
  /**
   * Optional explicit digest retention tags. When omitted, tags are derived
   * from `category` via `dimensionTagsForRule` (Performance CDs must be explicit).
   */
  dimensionTags?: AbilityDimensionTag[];
  sourceOwnership: SourceOwnership;
  sharedAcrossSpecs: boolean;
  availability: AbilityAvailability;
  cooldownSeconds?: number;
  /** Charge count when the ability has charges. */
  charges?: number;
  /**
   * When set, this SHARED/racial rule is only AVAILABLE for matching run-scoped race.
   * Observed use still promotes AVAILABLE even when race evidence is missing.
   */
  raceSlugs?: string[];
  /**
   * Interrupt opportunity profile. When omitted, derived from cooldown / ownership.
   */
  interruptProfile?: InterruptCapabilityProfile;
  requiresSuccessfulTarget?: boolean;
  /** canonicalKey of the ability this replaces. */
  replacementFor?: string;
  /** Additional spell IDs that resolve to this rule (aliases / cast variants). */
  aliases?: number[];
  /**
   * Spell IDs that count as the intentional activation signal
   * (defaults to spellIds + aliases when omitted). Shared across dimensions
   * for begincast/cast/buff dedup and parent/child attribution.
   */
  activationSpellIds?: number[];
  /** Buff aura IDs that mark the same activation window (cast+buff dedup). */
  activationBuffIds?: number[];
  /** Child / triggered effect IDs attributed to the parent activation. */
  triggeredEffectIds?: number[];
  /**
   * Event types that may observe the activation. Opening types are the
   * intersection of this list (when set) with `activationSource` defaults;
   * other listed / correlate types attach to an open activation.
   */
  activationEventTypes?: ActivationEventType[];
  /** Primary activation ownership model for counting uses. */
  activationSource?: ActivationSource;
  /**
   * When set, additional OPEN signals of this rule's activation spell IDs
   * within this many ms of the opening signal are treated as the same use
   * (e.g. Abomination Limb pulse casts during the limb effect).
   */
  activationEffectDurationMs?: number;
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
  /** Blizzard Game Data specialization id. */
  blizzardSpecId: number;
  notes?: string;
}

export interface RetailClassDefinition {
  slug: string;
  name: string;
  supportState: CatalogSupportState;
  /** Blizzard Game Data playable-class id. */
  blizzardClassId: number;
  specs: RetailSpecDefinition[];
  notes?: string;
}

export interface AbilityExternalMetadata {
  spellId: number;
  wowheadUrl: string | null;
  /** Normalized CDN icon stem when known. */
  iconName: string | null;
  /** Approved zamimg large-icon URL, or null when no identifier is available. */
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
