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

/** @deprecated Legacy lowercase aliases — prefer AbilityCategory. */
export type LegacyAbilityCategory =
  | "interrupt"
  | "crowd_control"
  | "personal_defensive"
  | "self_heal"
  | "health_potion"
  | "group_support"
  | "defensive_dispel"
  | "offensive_dispel";

export type AbilityRole = "DPS" | "TANK" | "HEALER";

export type SourceOwnership = "PLAYER" | "PET" | "GUARDIAN" | "ANY_OWNED";

export interface AbilityRule {
  /** One or more spell IDs that map to this rule. */
  spellIds: number[];
  /** Null = shared / cross-class (consumables, racials, etc.). */
  classSlug: string | null;
  /** Empty = all specs for the class (or shared). */
  specSlugs: string[];
  roles: AbilityRole[];
  category: AbilityCategory;
  sourceOwnership: SourceOwnership;
  cooldownSeconds?: number;
  requiresSuccessfulTarget?: boolean;
  sharedAcrossSpecs?: boolean;
  gameVersion?: string;
  petRequirement?: string;
  talentRequirements?: number[];
  validFromBuild?: string;
  validToBuild?: string;
}

export interface AbilityCatalog {
  catalogVersion: string;
  classSlug: string | null;
  specSlug: string | null;
  /** False when no class/spec catalog is registered for the lookup. */
  supported: boolean;
  unsupportedReason?: "ABILITY_CATALOG_UNSUPPORTED" | "CLASS_SPEC_UNKNOWN";
  rules: AbilityRule[];
}

export interface AbilityCatalogLookup {
  classSlug: string | null | undefined;
  specSlug?: string | null;
  role?: AbilityRole | null;
  gameVersion?: string | null;
}

export interface CatalogCoverageDiagnostics {
  classSlug: string | null;
  specSlug: string | null;
  supported: boolean;
  catalogVersion: string | null;
  unsupportedReason?: string;
  categoryCoverage: Record<AbilityCategory, number>;
  registeredClassSpecs: string[];
}
