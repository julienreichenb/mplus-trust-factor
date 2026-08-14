import type { AbilityRule } from "../types.js";

/**
 * Catalog-owned Survival active-heal eligibility.
 * Spec applicability lives on the rule (`survivalActiveHeal` + specSlugs).
 */
export function isSurvivalActiveHealRule(
  rule: AbilityRule,
  classSlug: string | null | undefined,
  specSlug: string | null | undefined,
): boolean {
  if (!rule.survivalActiveHeal) return false;
  if (rule.classSlug != null && classSlug && rule.classSlug !== classSlug) return false;
  if (rule.specSlugs.length > 0) {
    if (!specSlug || !rule.specSlugs.includes(specSlug)) return false;
  }
  return true;
}
