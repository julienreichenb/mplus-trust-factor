import type {
  AbilityAvailability,
  AbilityCategory,
  AbilityRole,
  AbilityRule,
  ApplicableCategoryResult,
} from "./types.js";
import { getAbilityCatalog } from "./registry.js";

const ALL_CATEGORIES: AbilityCategory[] = [
  "INTERRUPT",
  "HARD_CC",
  "SOFT_CC",
  "DISPEL",
  "PURGE",
  "DEFENSIVE_MAJOR",
  "DEFENSIVE_MINOR",
  "IMMUNITY",
  "SELF_HEAL",
  "EXTERNAL_DEFENSIVE",
  "GROUP_UTILITY",
  "MOVEMENT_UTILITY",
  "BATTLE_REZ",
  "BLOODLUST",
  "CONSUMABLE",
];

export interface GetApplicableOptions {
  classSlug: string;
  specSlug: string;
  role: AbilityRole;
  knownTalentSpellIds?: number[];
  gameVersion?: string;
  includeRacials?: boolean;
}

function isTalentSatisfied(rule: AbilityRule, knownTalentSpellIds?: number[]): boolean {
  if (rule.availability !== "TALENT" && rule.availability !== "CHOICE_NODE") return true;
  if (knownTalentSpellIds == null) return false;
  const ids = new Set([...rule.spellIds, ...(rule.aliases ?? [])]);
  return knownTalentSpellIds.some((id) => ids.has(id));
}

/**
 * Determines which ability categories are applicable for scoring a character.
 * Talent-only categories become uncertain when talent data is unavailable.
 */
export function getApplicableAbilityCategories(
  options: GetApplicableOptions,
): ApplicableCategoryResult[] {
  const resolved = getAbilityCatalog({
    classSlug: options.classSlug,
    specSlug: options.specSlug,
    role: options.role,
    gameVersion: options.gameVersion,
    includeShared: true,
    includeRacials: options.includeRacials ?? false,
  });

  if (!resolved.ok) {
    return ALL_CATEGORIES.map((category) => ({
      category,
      state: "not_applicable" as const,
      reason: resolved.reason,
      rules: [],
    }));
  }

  const results: ApplicableCategoryResult[] = [];

  for (const category of ALL_CATEGORIES) {
    const rules = resolved.catalog.rules.filter((r) => r.category === category);
    if (rules.length === 0) {
      results.push({
        category,
        state: "not_applicable",
        reason: "no_rules_for_category",
        rules: [],
      });
      continue;
    }

    // Shared consumables are always optional expectations, not universal penalties.
    if (category === "CONSUMABLE") {
      results.push({
        category,
        state: "applicable",
        reason: "shared_consumable",
        rules,
      });
      continue;
    }

    if (category === "BATTLE_REZ" || category === "BLOODLUST") {
      results.push({
        category,
        state: "applicable",
        reason: "optional_group_expectation",
        rules,
      });
      continue;
    }

    const baselineOrPet = rules.filter(
      (r) =>
        r.availability === "BASELINE" ||
        r.availability === "PET_DEPENDENT" ||
        r.availability === "FORM_DEPENDENT" ||
        r.availability === "SHARED",
    );
    const talentRules = rules.filter(
      (r) => r.availability === "TALENT" || r.availability === "CHOICE_NODE",
    );

    if (baselineOrPet.length > 0) {
      results.push({ category, state: "applicable", rules });
      continue;
    }

    if (talentRules.length > 0) {
      const satisfied = talentRules.filter((r) => isTalentSatisfied(r, options.knownTalentSpellIds));
      if (options.knownTalentSpellIds == null) {
        results.push({
          category,
          state: "uncertain",
          reason: "talent_data_unavailable",
          rules: talentRules,
        });
      } else if (satisfied.length > 0) {
        results.push({ category, state: "applicable", rules: satisfied });
      } else {
        results.push({
          category,
          state: "not_applicable",
          reason: "talent_not_selected",
          rules: talentRules,
        });
      }
      continue;
    }

    results.push({ category, state: "not_applicable", reason: "no_matching_availability", rules });
  }

  return results;
}

export function filterRulesByAvailability(
  rules: AbilityRule[],
  availability: AbilityAvailability[],
): AbilityRule[] {
  const set = new Set(availability);
  return rules.filter((r) => set.has(r.availability));
}
