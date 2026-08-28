import {
  defaultDimensionTagsForCategory,
  dimensionTagsForRule,
} from "../../catalog/rule.js";
import type { AbilityCategory, AbilityDimensionTag, AbilityRule } from "../../types.js";
import type { CuratedDraftRuleInput } from "./draft-validation.js";

export interface AbilityBusinessMetadataPatch {
  category?: AbilityCategory | null;
  availability?: CuratedDraftRuleInput["availability"];
}

/** Preserve explicit multi-tag rules when category is unchanged; derive on category change. */
export function dimensionTagsForBusinessMetadataEdit(
  activeRule: AbilityRule,
  newCategory: AbilityCategory | null | undefined,
): AbilityDimensionTag[] {
  if (newCategory == null || newCategory === activeRule.category) {
    return dimensionTagsForRule(activeRule);
  }
  return defaultDimensionTagsForCategory(newCategory);
}

/**
 * Merge admin business metadata onto the authoritative draft prefill.
 * Source-owned fields always come from `prefill`, never from the patch.
 */
export function applyBusinessMetadataToCuratedDraft(
  prefill: CuratedDraftRuleInput,
  patch: AbilityBusinessMetadataPatch,
  activeRule: AbilityRule,
): CuratedDraftRuleInput {
  const category = patch.category !== undefined ? patch.category : prefill.category;
  const availability = patch.availability !== undefined ? patch.availability : prefill.availability;
  return {
    ...prefill,
    category,
    availability,
    dimensionTags: dimensionTagsForBusinessMetadataEdit(activeRule, category),
  };
}
