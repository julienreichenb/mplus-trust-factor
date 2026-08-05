import type { AbilityRule } from "../../types.js";
import { ALL_ROLES, rule } from "../rule.js";

/** Cross-class consumables — never duplicated under individual class files. */
export const SHARED_CONSUMABLE_RULES: AbilityRule[] = [
  rule({
    canonicalKey: "shared.consumable.healthstone",
    name: "Healthstone",
    spellIds: [6262],
    aliases: [5512, 452930],
    activationSpellIds: [6262, 5512, 452930],
    activationSource: "ITEM_CAST",
    activationEventTypes: ["cast"],
    classSlug: null,
    roles: ALL_ROLES,
    category: "CONSUMABLE",
    availability: "SHARED",
    sharedAcrossSpecs: true,
    provenance: {
      source: "REPOSITORY_FIXTURE",
      sourceId: "warlock-demonology-tww-1",
      verifiedAt: "2026-07-28",
      gameVersion: "12.0.0",
      notes:
        "Item-use Healthstone IDs: 6262/5512 fixture; 452930 Demonic Healthstone heal-use (Wowhead). " +
        "Create Healthstone 6201 is excluded (crafting, not a combat consumable use).",
    },
  }),
  rule({
    canonicalKey: "shared.consumable.healing-potion",
    name: "Healing Potion",
    spellIds: [431416, 431418, 1234768],
    activationSpellIds: [431416, 431418, 1234768],
    activationSource: "ITEM_CAST",
    activationEventTypes: ["cast"],
    classSlug: null,
    roles: ALL_ROLES,
    category: "CONSUMABLE",
    availability: "SHARED",
    sharedAcrossSpecs: true,
    notes:
      "TWW/Midnight healing potion casts (431416/431418) plus Silvermoon Health Potion 1234768 (Wowhead). " +
      "One activation per item cast; related heal/buff evidence correlates only.",
  }),
];
