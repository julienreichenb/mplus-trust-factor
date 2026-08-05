import type {
  AbilityAvailability,
  AbilityCategory,
  AbilityDimensionTag,
  AbilityProvenance,
  AbilityRole,
  AbilityRule,
  ActivationEventType,
  ActivationSource,
  SourceOwnership,
} from "../types.js";
import { CATALOG_GAME_VERSION, CATALOG_VERIFIED_AT } from "../version.js";

export interface RuleInput {
  canonicalKey: string;
  name: string;
  spellIds: number[];
  /** Optional Wow icon CDN stem (with or without extension). */
  iconName?: string | null;
  classSlug: string | null;
  specSlugs?: string[];
  roles: AbilityRole[];
  category: AbilityCategory;
  dimensionTags?: AbilityDimensionTag[];
  sourceOwnership?: SourceOwnership;
  sharedAcrossSpecs?: boolean;
  availability?: AbilityAvailability;
  cooldownSeconds?: number;
  charges?: number;
  requiresSuccessfulTarget?: boolean;
  replacementFor?: string;
  aliases?: number[];
  activationSpellIds?: number[];
  activationBuffIds?: number[];
  triggeredEffectIds?: number[];
  activationEventTypes?: ActivationEventType[];
  activationSource?: ActivationSource;
  activationEffectDurationMs?: number;
  provenance?: Partial<AbilityProvenance>;
  supportCertainty?: "verified" | "uncertain" | "deprecated";
  notes?: string;
}

const DEFAULT_PROVENANCE: AbilityProvenance = {
  source: "CURATED_OVERRIDE",
  verifiedAt: CATALOG_VERIFIED_AT,
  gameVersion: CATALOG_GAME_VERSION,
  certainty: "verified",
};

/** Default dimension tags derived from scoring categories. */
export function defaultDimensionTagsForCategory(
  category: AbilityCategory,
): AbilityDimensionTag[] {
  switch (category) {
    case "INTERRUPT":
      return ["UTILITY_INTERRUPT"];
    case "DISPEL":
    case "PURGE":
      return ["UTILITY_DISPEL"];
    case "HARD_CC":
    case "SOFT_CC":
      return ["UTILITY_CROWD_CONTROL"];
    case "DEFENSIVE_MAJOR":
    case "DEFENSIVE_MINOR":
    case "IMMUNITY":
      return ["SURVIVAL_PERSONAL_DEFENSIVE"];
    case "SELF_HEAL":
    case "CONSUMABLE":
      return ["SURVIVAL_RECOVERY"];
    case "EXTERNAL_DEFENSIVE":
    case "GROUP_UTILITY":
    case "BLOODLUST":
    case "MOVEMENT_UTILITY":
      return ["UTILITY_EXTERNAL"];
    case "BATTLE_REZ":
      return ["UTILITY_COMBAT_RES"];
    case "OFFENSIVE_MAJOR":
    case "OFFENSIVE_MINOR":
      return ["PERFORMANCE_OFFENSIVE_COOLDOWN"];
    default:
      return [];
  }
}

/** Effective digest tags for a rule (explicit tags win; else category defaults). */
export function dimensionTagsForRule(rule: AbilityRule): AbilityDimensionTag[] {
  if (rule.dimensionTags && rule.dimensionTags.length > 0) {
    return [...new Set(rule.dimensionTags)];
  }
  return defaultDimensionTagsForCategory(rule.category);
}

/** True when the rule should be retained in combat digests. */
export function isDigestRelevantRule(rule: AbilityRule): boolean {
  return dimensionTagsForRule(rule).length > 0;
}

const SURVIVAL_ACTIVATION_CATEGORIES = new Set<AbilityCategory>([
  "DEFENSIVE_MAJOR",
  "DEFENSIVE_MINOR",
  "IMMUNITY",
  "SELF_HEAL",
  "CONSUMABLE",
  "EXTERNAL_DEFENSIVE",
]);

/**
 * Survival cast-primary defaults: only resolved casts open activations.
 * Buff/refresh/absorb/trigger events correlate via activation metadata.
 * Override with activationSource PLAYER_BUFF for aura-only defensives.
 */
function defaultSurvivalActivation(
  input: RuleInput,
): Pick<
  AbilityRule,
  | "activationSource"
  | "activationEventTypes"
  | "activationSpellIds"
  | "activationBuffIds"
> {
  const activationSource: ActivationSource =
    input.activationSource ??
    (input.category === "CONSUMABLE" ? "ITEM_CAST" : "PLAYER_CAST");
  const activationEventTypes: ActivationEventType[] =
    input.activationEventTypes ??
    (activationSource === "PLAYER_BUFF"
      ? ["applybuff"]
      : input.category === "EXTERNAL_DEFENSIVE"
        ? ["cast", "applybuff"]
        : ["cast"]);
  return {
    activationSource,
    activationEventTypes,
    activationSpellIds: input.activationSpellIds
      ? [...input.activationSpellIds]
      : [...input.spellIds],
    activationBuffIds: input.activationBuffIds
      ? [...input.activationBuffIds]
      : activationSource === "PLAYER_BUFF"
        ? [...input.spellIds]
        : undefined,
  };
}

/** Builds a catalog rule with default provenance and ownership. */
export function rule(input: RuleInput): AbilityRule {
  const provenance: AbilityProvenance = {
    ...DEFAULT_PROVENANCE,
    ...input.provenance,
    notes: input.notes ?? input.provenance?.notes,
    certainty: input.supportCertainty ?? input.provenance?.certainty ?? DEFAULT_PROVENANCE.certainty,
  };

  const survivalDefaults = SURVIVAL_ACTIVATION_CATEGORIES.has(input.category)
    ? defaultSurvivalActivation(input)
    : null;

  return {
    canonicalKey: input.canonicalKey,
    name: input.name,
    spellIds: [...input.spellIds],
    iconName: input.iconName ?? null,
    classSlug: input.classSlug,
    specSlugs: input.specSlugs ? [...input.specSlugs] : [],
    roles: [...input.roles],
    category: input.category,
    ...(input.dimensionTags && input.dimensionTags.length > 0
      ? { dimensionTags: [...input.dimensionTags] }
      : {}),
    sourceOwnership: input.sourceOwnership ?? "PLAYER",
    sharedAcrossSpecs:
      input.sharedAcrossSpecs ?? (input.specSlugs == null || input.specSlugs.length === 0),
    availability: input.availability ?? "BASELINE",
    cooldownSeconds: input.cooldownSeconds,
    charges: input.charges,
    requiresSuccessfulTarget: input.requiresSuccessfulTarget,
    replacementFor: input.replacementFor,
    aliases: input.aliases ? [...input.aliases] : undefined,
    activationSpellIds:
      input.activationSpellIds?.length
        ? [...input.activationSpellIds]
        : survivalDefaults?.activationSpellIds,
    activationBuffIds:
      input.activationBuffIds?.length
        ? [...input.activationBuffIds]
        : survivalDefaults?.activationBuffIds,
    triggeredEffectIds: input.triggeredEffectIds ? [...input.triggeredEffectIds] : undefined,
    activationEventTypes:
      input.activationEventTypes?.length
        ? [...input.activationEventTypes]
        : survivalDefaults?.activationEventTypes,
    activationSource: input.activationSource ?? survivalDefaults?.activationSource,
    activationEffectDurationMs: input.activationEffectDurationMs,
    provenance,
    supportCertainty: input.supportCertainty ?? provenance.certainty,
  };
}

/**
 * Convenience authoring helper for Performance cooldown entries in the
 * canonical class catalog. Same AbilityRule type as Utility/Survival —
 * defaults activation correlation metadata and OFFENSIVE_* category tags.
 */
export function performanceCooldownRule(
  input: Omit<RuleInput, "category"> & {
    category: "OFFENSIVE_MAJOR" | "OFFENSIVE_MINOR";
  },
): AbilityRule {
  const activationSource = input.activationSource ?? "PLAYER_CAST";
  const defaultEventTypes: ActivationEventType[] =
    activationSource === "PLAYER_BUFF"
      ? ["applybuff", "cast", "begincast"]
      : activationSource === "PLAYER_EMPOWERED_CAST"
        ? ["cast", "empowerstart", "empowerend", "begincast", "applybuff"]
        : ["begincast", "cast", "applybuff"];
  return rule({
    ...input,
    activationEventTypes: input.activationEventTypes ?? defaultEventTypes,
    activationSource,
    sharedAcrossSpecs:
      input.sharedAcrossSpecs ??
      (input.specSlugs != null && input.specSlugs.length > 0 ? false : undefined),
  });
}

export const ALL_ROLES: AbilityRole[] = ["DPS", "TANK", "HEALER"];
export const DPS: AbilityRole[] = ["DPS"];
export const TANK: AbilityRole[] = ["TANK"];
export const HEALER: AbilityRole[] = ["HEALER"];
export const TANK_DPS: AbilityRole[] = ["TANK", "DPS"];
export const HEALER_DPS: AbilityRole[] = ["HEALER", "DPS"];
