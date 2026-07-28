import type { AbilityCatalog } from "../types.js";
import { withSharedRules } from "./shared.js";

/** Melee interrupt fixture — Warrior Arms (Pummel). */
export const WARRIOR_ARMS_CATALOG: AbilityCatalog = withSharedRules({
  catalogVersion: "warrior-arms-tww-1",
  classSlug: "warrior",
  specSlug: "arms",
  supported: true,
  rules: [
    {
      spellIds: [6552],
      classSlug: "warrior",
      specSlugs: ["arms", "fury", "protection"],
      roles: ["DPS", "TANK"],
      category: "INTERRUPT",
      sourceOwnership: "PLAYER",
      cooldownSeconds: 15,
      sharedAcrossSpecs: true,
    },
    {
      spellIds: [5246],
      classSlug: "warrior",
      specSlugs: [],
      roles: ["DPS", "TANK"],
      category: "SOFT_CC",
      sourceOwnership: "PLAYER",
      cooldownSeconds: 90,
    },
    {
      spellIds: [118038],
      classSlug: "warrior",
      specSlugs: ["arms"],
      roles: ["DPS"],
      category: "DEFENSIVE_MAJOR",
      sourceOwnership: "PLAYER",
      cooldownSeconds: 120,
    },
  ],
});
