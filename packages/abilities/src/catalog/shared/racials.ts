import type { AbilityRule } from "../../types.js";
import { ALL_ROLES, rule } from "../rule.js";

/**
 * Racials are optional for scoring. Included with SHARED availability so scorers
 * can opt in without treating them as universal expectations.
 */
export const SHARED_RACIAL_RULES: AbilityRule[] = [
  rule({
    canonicalKey: "shared.racial.stoneform",
    name: "Stoneform",
    spellIds: [20594],
    classSlug: null,
    roles: ALL_ROLES,
    category: "DISPEL",
    availability: "SHARED",
    sharedAcrossSpecs: true,
    cooldownSeconds: 120,
    supportCertainty: "uncertain",
    notes: "Dwarf racial self-dispel — scoring may ignore racials unless explicitly enabled.",
  }),
  rule({
    canonicalKey: "shared.racial.fireblood",
    name: "Fireblood",
    spellIds: [265221],
    classSlug: null,
    roles: ALL_ROLES,
    category: "DISPEL",
    availability: "SHARED",
    sharedAcrossSpecs: true,
    cooldownSeconds: 120,
    supportCertainty: "uncertain",
    notes: "Dark Iron Dwarf racial — scoring may ignore racials unless explicitly enabled.",
  }),
  rule({
    canonicalKey: "shared.racial.escape-artist",
    name: "Escape Artist",
    spellIds: [20589],
    classSlug: null,
    roles: ALL_ROLES,
    category: "MOVEMENT_UTILITY",
    availability: "SHARED",
    sharedAcrossSpecs: true,
    cooldownSeconds: 60,
    supportCertainty: "uncertain",
    notes: "Gnome racial root/snare break — optional scoring input.",
  }),
  rule({
    canonicalKey: "shared.racial.shadowmeld",
    name: "Shadowmeld",
    spellIds: [58984],
    classSlug: null,
    roles: ALL_ROLES,
    category: "DEFENSIVE_MINOR",
    availability: "SHARED",
    sharedAcrossSpecs: true,
    cooldownSeconds: 120,
    supportCertainty: "uncertain",
    notes: "Night Elf racial — Utility V2 mechanic-avoidance domain when enabled.",
  }),
];
