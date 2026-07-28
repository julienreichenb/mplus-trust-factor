import type { AbilityCatalog } from "../types.js";
import { withSharedRules } from "./shared.js";

/** Tank defensive fixture — Warrior Protection. */
export const WARRIOR_PROTECTION_CATALOG: AbilityCatalog = withSharedRules({
  catalogVersion: "warrior-protection-tww-1",
  classSlug: "warrior",
  specSlug: "protection",
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
      spellIds: [871],
      classSlug: "warrior",
      specSlugs: ["protection"],
      roles: ["TANK"],
      category: "DEFENSIVE_MAJOR",
      sourceOwnership: "PLAYER",
      cooldownSeconds: 210,
    },
    {
      spellIds: [12975],
      classSlug: "warrior",
      specSlugs: ["protection"],
      roles: ["TANK"],
      category: "DEFENSIVE_MAJOR",
      sourceOwnership: "PLAYER",
      cooldownSeconds: 180,
    },
    {
      spellIds: [23920],
      classSlug: "warrior",
      specSlugs: ["protection"],
      roles: ["TANK"],
      category: "DEFENSIVE_MINOR",
      sourceOwnership: "PLAYER",
      cooldownSeconds: 25,
    },
  ],
});
