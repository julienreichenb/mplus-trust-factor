import type { AbilityCatalog } from "../types.js";
import { withSharedRules } from "./shared.js";

/** Healer dispel fixture — Priest Holy. */
export const PRIEST_HOLY_CATALOG: AbilityCatalog = withSharedRules({
  catalogVersion: "priest-holy-tww-1",
  classSlug: "priest",
  specSlug: "holy",
  supported: true,
  rules: [
    {
      spellIds: [527],
      classSlug: "priest",
      specSlugs: ["holy", "discipline"],
      roles: ["HEALER"],
      category: "DISPEL",
      sourceOwnership: "PLAYER",
      cooldownSeconds: 8,
    },
    {
      spellIds: [88625],
      classSlug: "priest",
      specSlugs: ["holy"],
      roles: ["HEALER"],
      category: "HARD_CC",
      sourceOwnership: "PLAYER",
      cooldownSeconds: 30,
    },
    {
      spellIds: [19236],
      classSlug: "priest",
      specSlugs: ["holy", "discipline", "shadow"],
      roles: ["HEALER", "DPS"],
      category: "DEFENSIVE_MAJOR",
      sourceOwnership: "PLAYER",
      cooldownSeconds: 90,
    },
    // Holy has no interrupt — absence must not score as zero.
  ],
});
