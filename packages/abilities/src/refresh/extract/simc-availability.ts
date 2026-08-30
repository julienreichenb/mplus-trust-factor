import type { AbilityAvailability } from "../../types.js";
import type { InventoryScopeClassification } from "../types.js";

/** SimC SpellQuery dataset membership for a spell (source-owned evidence). */
export interface SimcSpellMembership {
  classSpell: boolean;
  specSpell: boolean;
  raceSpell: boolean;
  talentSpell: boolean;
}

export const EMPTY_SIMC_SPELL_MEMBERSHIP: SimcSpellMembership = {
  classSpell: false,
  specSpell: false,
  raceSpell: false,
  talentSpell: false,
};

export function membershipFlagForScope(
  scope: "class_spell" | "spec_spell" | "race_spell" | "talent_spell",
): keyof SimcSpellMembership {
  switch (scope) {
    case "class_spell":
      return "classSpell";
    case "spec_spell":
      return "specSpell";
    case "race_spell":
      return "raceSpell";
    case "talent_spell":
      return "talentSpell";
  }
}

export function membershipFromScope(
  scope: "class_spell" | "spec_spell" | "race_spell" | "talent_spell",
): SimcSpellMembership {
  return { ...EMPTY_SIMC_SPELL_MEMBERSHIP, [membershipFlagForScope(scope)]: true };
}

export function mergeSimcMembership(
  a: SimcSpellMembership | undefined,
  b: SimcSpellMembership | undefined,
): SimcSpellMembership {
  return {
    classSpell: Boolean(a?.classSpell || b?.classSpell),
    specSpell: Boolean(a?.specSpell || b?.specSpell),
    raceSpell: Boolean(a?.raceSpell || b?.raceSpell),
    talentSpell: Boolean(a?.talentSpell || b?.talentSpell),
  };
}

export function parseSimcMembership(value: unknown): SimcSpellMembership | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  return {
    classSpell: Boolean(row.classSpell),
    specSpell: Boolean(row.specSpell),
    raceSpell: Boolean(row.raceSpell),
    talentSpell: Boolean(row.talentSpell),
  };
}

/**
 * Deterministic AbilityAvailability from pinned SimC SpellQuery membership.
 * Precedence: SHARED → PET_DEPENDENT → TALENT → BASELINE.
 * FORM_DEPENDENT / CHOICE_NODE require evidence not exposed by current SpellQuery XML.
 */
export function deriveAvailabilityFromSimcMembership(
  membership: SimcSpellMembership,
  ownershipKind: InventoryScopeClassification | "PLAYABLE_PLAYER" | null | undefined,
): AbilityAvailability | null {
  if (membership.raceSpell) return "SHARED";
  if (ownershipKind === "PET_TALENT_TREE") return "PET_DEPENDENT";
  if (membership.talentSpell) return "TALENT";
  if (membership.classSpell || membership.specSpell) return "BASELINE";
  return null;
}
