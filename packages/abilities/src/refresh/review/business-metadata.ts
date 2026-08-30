import {
  defaultDimensionTagsForCategory,
  dimensionTagsForRule,
} from "../../catalog/rule.js";
import type { AbilityCategory, AbilityDimensionTag, AbilityRule } from "../../types.js";
import type { CuratedDraftRuleInput } from "./draft-validation.js";

export interface AbilityBusinessMetadataPatch {
  category?: AbilityCategory | null;
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
  return {
    ...prefill,
    category,
    availability: prefill.availability,
    dimensionTags: dimensionTagsForBusinessMetadataEdit(activeRule, category),
  };
}

/** Preserve explicit multi-tag drafts when category is unchanged; derive on category change. */
export function dimensionTagsForReviewDraftEdit(
  prefill: CuratedDraftRuleInput,
  patch: AbilityBusinessMetadataPatch,
): AbilityDimensionTag[] {
  const category = patch.category !== undefined ? patch.category : prefill.category;
  if (category == null) return prefill.dimensionTags ?? [];
  if (category === prefill.category && prefill.dimensionTags?.length) {
    return [...prefill.dimensionTags];
  }
  return defaultDimensionTagsForCategory(category);
}

/**
 * Merge admin business metadata onto a server-side review draft prefill.
 * Source-owned fields always come from `prefill`, never from the patch.
 */
export function applyBusinessMetadataToReviewDraft(
  prefill: CuratedDraftRuleInput,
  patch: AbilityBusinessMetadataPatch,
): CuratedDraftRuleInput {
  const category = patch.category !== undefined ? patch.category : prefill.category;
  return {
    ...prefill,
    category,
    availability: prefill.availability,
    dimensionTags: dimensionTagsForReviewDraftEdit(prefill, patch),
  };
}
