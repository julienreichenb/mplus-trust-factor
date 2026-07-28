import type { AbilityRule } from "../../types.js";
import { ALL_ROLES, rule } from "../rule.js";

/** Cross-class consumables — never duplicated under individual class files. */
export const SHARED_CONSUMABLE_RULES: AbilityRule[] = [
  rule({
    canonicalKey: "shared.consumable.healthstone",
    name: "Healthstone",
    spellIds: [6262],
    aliases: [5512],
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
      notes: "Item use / create Healthstone cast IDs from verified Wave 4 fixture.",
    },
  }),
  rule({
    canonicalKey: "shared.consumable.healing-potion",
    name: "Healing Potion",
    spellIds: [431416, 431418],
    classSlug: null,
    roles: ALL_ROLES,
    category: "CONSUMABLE",
    availability: "SHARED",
    sharedAcrossSpecs: true,
    notes: "TWW/Midnight-era healing potion cast IDs retained from verified fixture; re-verify on patch.",
  }),
];
