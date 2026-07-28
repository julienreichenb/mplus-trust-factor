import type { AbilityCatalog, AbilityRule } from "../types.js";

/** Shared consumables / racial-agnostic items — not duplicated per specialization. */
export const SHARED_CONSUMABLE_RULES: AbilityRule[] = [
  {
    spellIds: [6262, 5512],
    classSlug: null,
    specSlugs: [],
    roles: ["DPS", "TANK", "HEALER"],
    category: "CONSUMABLE",
    sourceOwnership: "PLAYER",
    sharedAcrossSpecs: true,
  },
  {
    spellIds: [431416, 431418],
    classSlug: null,
    specSlugs: [],
    roles: ["DPS", "TANK", "HEALER"],
    category: "CONSUMABLE",
    sourceOwnership: "PLAYER",
    sharedAcrossSpecs: true,
    gameVersion: "tww",
  },
];

export function withSharedRules(catalog: Omit<AbilityCatalog, "rules"> & { rules: AbilityRule[] }): AbilityCatalog {
  return {
    ...catalog,
    rules: [...SHARED_CONSUMABLE_RULES, ...catalog.rules],
  };
}
