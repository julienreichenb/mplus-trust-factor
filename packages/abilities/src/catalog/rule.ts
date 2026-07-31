import type {
  AbilityAvailability,
  AbilityCategory,
  AbilityProvenance,
  AbilityRole,
  AbilityRule,
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
  sourceOwnership?: SourceOwnership;
  sharedAcrossSpecs?: boolean;
  availability?: AbilityAvailability;
  cooldownSeconds?: number;
  requiresSuccessfulTarget?: boolean;
  replacementFor?: string;
  aliases?: number[];
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

/** Builds a catalog rule with default provenance and ownership. */
export function rule(input: RuleInput): AbilityRule {
  const provenance: AbilityProvenance = {
    ...DEFAULT_PROVENANCE,
    ...input.provenance,
    notes: input.notes ?? input.provenance?.notes,
    certainty: input.supportCertainty ?? input.provenance?.certainty ?? DEFAULT_PROVENANCE.certainty,
  };

  return {
    canonicalKey: input.canonicalKey,
    name: input.name,
    spellIds: [...input.spellIds],
    iconName: input.iconName ?? null,
    classSlug: input.classSlug,
    specSlugs: input.specSlugs ? [...input.specSlugs] : [],
    roles: [...input.roles],
    category: input.category,
    sourceOwnership: input.sourceOwnership ?? "PLAYER",
    sharedAcrossSpecs: input.sharedAcrossSpecs ?? (input.specSlugs == null || input.specSlugs.length === 0),
    availability: input.availability ?? "BASELINE",
    cooldownSeconds: input.cooldownSeconds,
    requiresSuccessfulTarget: input.requiresSuccessfulTarget,
    replacementFor: input.replacementFor,
    aliases: input.aliases ? [...input.aliases] : undefined,
    provenance,
    supportCertainty: input.supportCertainty ?? provenance.certainty,
  };
}

export const ALL_ROLES: AbilityRole[] = ["DPS", "TANK", "HEALER"];
export const DPS: AbilityRole[] = ["DPS"];
export const TANK: AbilityRole[] = ["TANK"];
export const HEALER: AbilityRole[] = ["HEALER"];
export const TANK_DPS: AbilityRole[] = ["TANK", "DPS"];
export const HEALER_DPS: AbilityRole[] = ["HEALER", "DPS"];
