import { isKnownRetailSpec } from "./topology.js";
import type { InventoryScopeClassification } from "./types.js";

/** Hunter pet talent trees as emitted by SimC SpellQuery `<spec name>`. Not playable specs. */
export const SIMC_PET_TALENT_TREE_SLUGS = new Set(["cunning", "ferocity", "tenacity"]);

export function classifySpecScope(
  classSlug: string | null,
  specSlug: string,
): InventoryScopeClassification {
  if (SIMC_PET_TALENT_TREE_SLUGS.has(specSlug)) return "PET_TALENT_TREE";
  if (classSlug && isKnownRetailSpec(classSlug, specSlug)) return "PLAYABLE_SPEC";
  return "PSEUDO_SPEC";
}

export function classifyRecordOwnership(input: {
  classSlug: string | null;
  specSlugs: string[];
  raceSlugs: string[];
}): InventoryScopeClassification | "PLAYABLE_PLAYER" {
  const specKinds = input.specSlugs.map((s) => classifySpecScope(input.classSlug, s));
  if (specKinds.some((k) => k === "PET_TALENT_TREE")) return "PET_TALENT_TREE";
  if (specKinds.some((k) => k === "PSEUDO_SPEC") && !specKinds.some((k) => k === "PLAYABLE_SPEC")) {
    return "PSEUDO_SPEC";
  }
  if (input.raceSlugs.length > 0 && !input.classSlug) return "PLAYABLE_RACE";
  if (input.classSlug || specKinds.some((k) => k === "PLAYABLE_SPEC")) return "PLAYABLE_PLAYER";
  return "PSEUDO_SPEC";
}

export function raceNumericIdsMustNotJoin(simcRaceId: number, blizzardRaceId: number): boolean {
  return simcRaceId === blizzardRaceId;
}
