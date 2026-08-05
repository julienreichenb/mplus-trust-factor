import { dimensionTagsForRule } from "../../catalog/rule.js";
import { getAllRegisteredRules } from "../../registry.js";
import type { AbilityRule } from "../../types.js";
import {
  CATALOG_GAME_VERSION,
  CURRENT_CATALOG_VERSION_ID,
} from "../../version.js";
import type {
  OffensiveCandidateCooldownCategory,
  OffensiveSourceAdapter,
  OffensiveSourceSnapshot,
} from "./types.js";

function candidateCategoryForRule(
  rule: AbilityRule,
): OffensiveCandidateCooldownCategory | null {
  switch (rule.category) {
    case "OFFENSIVE_MAJOR":
      return "MAJOR";
    case "OFFENSIVE_MINOR":
      return rule.classSlug == null ? "RACIAL" : "MINOR";
    case "GROUP_UTILITY":
      return "EXTERNAL_OFFENSIVE";
    default:
      return rule.classSlug == null ? "RACIAL" : null;
  }
}

/**
 * Existing project catalog adapter.
 * Preserves canonical keys and metadata for rules already tagged offensive.
 */
export const existingCatalogAdapter: OffensiveSourceAdapter = {
  meta: {
    kind: "EXISTING_CATALOG",
    adapterId: "project-canonical-catalog",
    licenseNote: "First-party curated catalog — canonical ownership stays in packages/abilities.",
    mayProposeClassification: true,
  },

  loadSnapshot(input): OffensiveSourceSnapshot {
    const gameVersion = input.gameVersion || CATALOG_GAME_VERSION;
    const catalogVersion = input.catalogVersion || CURRENT_CATALOG_VERSION_ID;
    const rules = getAllRegisteredRules();
    const candidates = rules
      .filter((rule) => dimensionTagsForRule(rule).includes("PERFORMANCE_OFFENSIVE_COOLDOWN"))
      .map((rule) => ({
        proposedCanonicalKey: rule.canonicalKey,
        canonicalName: rule.name,
        primarySpellId: rule.spellIds[0] ?? 0,
        aliasSpellIds: [...(rule.aliases ?? [])],
        activationSpellIds: [...(rule.activationSpellIds ?? rule.spellIds)],
        activationBuffIds: [...(rule.activationBuffIds ?? [])],
        triggeredEffectIds: [...(rule.triggeredEffectIds ?? [])],
        classSlug: rule.classSlug,
        allowedSpecSlugs: [...rule.specSlugs],
        allowedRoleSlugs: [...rule.roles],
        cooldownCategory: candidateCategoryForRule(rule),
        activationEventTypes: [...(rule.activationEventTypes ?? ["cast"])],
        activationSource: rule.activationSource ?? null,
        expectedCooldownSeconds: rule.cooldownSeconds ?? null,
        charges: rule.charges ?? null,
        classificationConfidence: 1,
        reviewStatus: "REVIEWED" as const,
        provenance: rule.provenance,
        notes: rule.provenance.notes ? [rule.provenance.notes] : [],
        matchedCanonicalKey: rule.canonicalKey,
      }));

    return {
      meta: this.meta,
      gameVersion,
      catalogVersion,
      generatedAt: new Date().toISOString(),
      candidates,
    };
  },
};
