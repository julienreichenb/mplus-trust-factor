export type AbilityCategory =
  | "interrupt"
  | "crowd_control"
  | "personal_defensive"
  | "self_heal"
  | "health_potion"
  | "group_support"
  | "defensive_dispel"
  | "offensive_dispel";

export interface AbilityRule {
  spellId: number;
  classSlug: string;
  specSlugs?: string[];
  categories: AbilityCategory[];
  baseCooldownMs?: number;
  petRequirement?: string;
  talentRequirements?: number[];
  validFromBuild?: string;
  validToBuild?: string;
}

export interface AbilityCatalog {
  catalogVersion: string;
  rules: AbilityRule[];
}
