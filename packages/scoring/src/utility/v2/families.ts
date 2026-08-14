/**
 * Central Utility scoring-family map.
 *
 * Families are derived from Ability Catalog categories (and digest utility
 * categories as a fallback). Mapping is category-based — never spell-ID lists.
 */

import type { AbilityCategory, AbilityRule } from "@mplus/abilities";
import { dimensionTagsForRule } from "@mplus/abilities";
import type { UtilityCategory } from "@mplus/contracts";

export const UTILITY_V2_FAMILY_KEYS = [
  "interrupt",
  "crowdControl",
  "dispelPurge",
  "groupSupport",
  "movement",
  "combatRes",
  "bloodlust",
] as const;

export type UtilityV2FamilyKey = (typeof UTILITY_V2_FAMILY_KEYS)[number];

export type UtilityFamilyApplicabilityState =
  | "applicable"
  | "not_applicable"
  | "uncertain"
  | "optional";

export interface UtilityFamilyApplicability {
  state: UtilityFamilyApplicabilityState;
  reason?: string;
}

export type UtilityFamilyApplicabilityMap = Record<
  UtilityV2FamilyKey,
  UtilityFamilyApplicability
>;

/** Catalog categories that feed each scoring family. */
export const UTILITY_FAMILY_CATALOG_CATEGORIES: Record<
  UtilityV2FamilyKey,
  readonly AbilityCategory[]
> = {
  interrupt: ["INTERRUPT"],
  crowdControl: ["HARD_CC", "SOFT_CC"],
  dispelPurge: ["DISPEL", "PURGE"],
  groupSupport: ["EXTERNAL_DEFENSIVE", "GROUP_UTILITY"],
  movement: ["MOVEMENT_UTILITY"],
  combatRes: ["BATTLE_REZ"],
  bloodlust: ["BLOODLUST"],
};

const CATALOG_CATEGORY_TO_FAMILY: Partial<Record<AbilityCategory, UtilityV2FamilyKey>> =
  {
    INTERRUPT: "interrupt",
    HARD_CC: "crowdControl",
    SOFT_CC: "crowdControl",
    DISPEL: "dispelPurge",
    PURGE: "dispelPurge",
    EXTERNAL_DEFENSIVE: "groupSupport",
    GROUP_UTILITY: "groupSupport",
    MOVEMENT_UTILITY: "movement",
    BATTLE_REZ: "combatRes",
    BLOODLUST: "bloodlust",
  };

const DIGEST_CATEGORY_TO_FAMILY: Record<UtilityCategory, UtilityV2FamilyKey | null> = {
  INTERRUPT: "interrupt",
  CROWD_CONTROL: "crowdControl",
  STOP: "crowdControl",
  OFFENSIVE_DISPEL: "dispelPurge",
  DEFENSIVE_DISPEL: "dispelPurge",
  COMBAT_RES: "combatRes",
  EXTERNAL_SUPPORT: "groupSupport",
  OTHER_UTILITY: "movement",
};

export function emptyFamilyApplicability(
  state: UtilityFamilyApplicabilityState = "not_applicable",
  reason?: string,
): UtilityFamilyApplicabilityMap {
  const out = {} as UtilityFamilyApplicabilityMap;
  for (const key of UTILITY_V2_FAMILY_KEYS) {
    out[key] = reason ? { state, reason } : { state };
  }
  return out;
}

export function isUtilityTaggedRule(rule: AbilityRule): boolean {
  return dimensionTagsForRule(rule).some((tag) => tag.startsWith("UTILITY_"));
}

/** Map a catalog category to a scoring family, or null when not a Utility family. */
export function utilityFamilyFromCatalogCategory(
  category: AbilityCategory,
): UtilityV2FamilyKey | null {
  return CATALOG_CATEGORY_TO_FAMILY[category] ?? null;
}

/**
 * Movement only scores when the catalog marks the rule as Utility.
 * Other mapped categories are Utility by taxonomy.
 */
export function utilityFamilyFromCatalogRule(rule: AbilityRule): UtilityV2FamilyKey | null {
  const family = utilityFamilyFromCatalogCategory(rule.category);
  if (family == null) return null;
  if (family === "movement" && !isUtilityTaggedRule(rule)) return null;
  return family;
}

export function utilityFamilyFromDigestCategory(
  category: UtilityCategory,
): UtilityV2FamilyKey | null {
  return DIGEST_CATEGORY_TO_FAMILY[category] ?? null;
}

export function isOptionalUtilityFamily(family: UtilityV2FamilyKey): boolean {
  return family === "combatRes" || family === "bloodlust";
}

export function mergeFamilyApplicability(
  maps: UtilityFamilyApplicabilityMap[],
): UtilityFamilyApplicabilityMap {
  const out = emptyFamilyApplicability("not_applicable");
  if (maps.length === 0) return out;
  for (const family of UTILITY_V2_FAMILY_KEYS) {
    const states = maps.map((m) => m[family]);
    if (states.some((s) => s.state === "applicable")) {
      const hit = states.find((s) => s.state === "applicable")!;
      out[family] = { state: "applicable", reason: hit.reason };
      continue;
    }
    if (states.some((s) => s.state === "uncertain")) {
      const hit = states.find((s) => s.state === "uncertain")!;
      out[family] = { state: "uncertain", reason: hit.reason };
      continue;
    }
    if (states.some((s) => s.state === "optional")) {
      const hit = states.find((s) => s.state === "optional")!;
      out[family] = { state: "optional", reason: hit.reason };
      continue;
    }
    const first = states[0]!;
    out[family] = { state: "not_applicable", reason: first.reason };
  }
  return out;
}

/**
 * Legacy three-boolean toolkit flags claim *confirmed* availability only.
 * Uncertain (unknown identity / talent-gated) must not fabricate a toolkit.
 */
export function legacyToolkitBooleansFromFamilies(
  families: UtilityFamilyApplicabilityMap,
): { hasInterrupt: boolean; hasSupport: boolean; hasStrategicCc: boolean } {
  const confirmed = (state: UtilityFamilyApplicabilityState) =>
    state === "applicable" || state === "optional";
  return {
    hasInterrupt: confirmed(families.interrupt.state),
    hasSupport:
      confirmed(families.groupSupport.state) ||
      confirmed(families.dispelPurge.state) ||
      confirmed(families.combatRes.state) ||
      confirmed(families.bloodlust.state),
    hasStrategicCc: confirmed(families.crowdControl.state),
  };
}

/**
 * Interpret a fact-set toolkit that may only carry the legacy three booleans.
 */
export function familiesFromLegacyToolkit(toolkit: {
  hasInterrupt: boolean;
  hasSupport: boolean;
  hasStrategicCc: boolean;
  families?: UtilityFamilyApplicabilityMap;
}): UtilityFamilyApplicabilityMap {
  if (toolkit.families) return toolkit.families;
  const families = emptyFamilyApplicability("not_applicable", "legacy_toolkit_absent");
  families.interrupt = {
    state: toolkit.hasInterrupt ? "applicable" : "not_applicable",
    reason: toolkit.hasInterrupt ? "legacy_toolkit_flag" : "legacy_toolkit_absent",
  };
  families.crowdControl = {
    state: toolkit.hasStrategicCc ? "applicable" : "not_applicable",
    reason: toolkit.hasStrategicCc ? "legacy_toolkit_flag" : "legacy_toolkit_absent",
  };
  families.dispelPurge = {
    state: toolkit.hasSupport ? "applicable" : "not_applicable",
    reason: toolkit.hasSupport ? "legacy_toolkit_flag" : "legacy_toolkit_absent",
  };
  families.groupSupport = {
    state: toolkit.hasSupport ? "applicable" : "not_applicable",
    reason: toolkit.hasSupport ? "legacy_toolkit_flag" : "legacy_toolkit_absent",
  };
  families.combatRes = {
    state: "optional",
    reason: "optional_group_expectation",
  };
  families.bloodlust = {
    state: "optional",
    reason: "optional_group_expectation",
  };
  families.movement = { state: "not_applicable", reason: "legacy_toolkit_absent" };
  return families;
}
