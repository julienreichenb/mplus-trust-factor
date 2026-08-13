import type {
  AbilityAvailability,
  AbilityCategory,
  AbilityRole,
  AbilityRule,
  ApplicableCategoryResult,
} from "./types.js";
import { resolveAbilityCatalog } from "./registry.js";

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
  /** Observed Utility spell IDs for this run — prove availability even if talent metadata is incomplete. */
  observedSpellIds?: number[];
  gameVersion?: string;
  includeRacials?: boolean;
}

/**
 * Per-ability capability for a run-scoped toolkit.
 * Never collapse UNKNOWN into AVAILABLE.
 */
export type AbilityCapabilityState = "AVAILABLE" | "NOT_AVAILABLE" | "UNKNOWN";

export interface AbilityCapabilityResolution {
  rule: AbilityRule;
  state: AbilityCapabilityState;
  reason: string;
}

function ruleSpellIdSet(rule: AbilityRule): Set<number> {
  return new Set([...rule.spellIds, ...(rule.aliases ?? [])]);
}

function isTalentSatisfied(rule: AbilityRule, knownTalentSpellIds?: number[]): boolean {
  if (rule.availability !== "TALENT" && rule.availability !== "CHOICE_NODE") return true;
  if (knownTalentSpellIds == null) return false;
  const ids = ruleSpellIdSet(rule);
  return knownTalentSpellIds.some((id) => ids.has(id));
}

function isObserved(rule: AbilityRule, observedSpellIds?: number[]): boolean {
  if (observedSpellIds == null || observedSpellIds.length === 0) return false;
  const ids = ruleSpellIdSet(rule);
  return observedSpellIds.some((id) => ids.has(id));
}

/**
 * Resolve one catalog rule into AVAILABLE / NOT_AVAILABLE / UNKNOWN for a run.
 *
 * Precedence: observed use > baseline/pet/shared > talent selection > missing talent evidence.
 */
export function resolveAbilityCapability(
  rule: AbilityRule,
  options: {
    knownTalentSpellIds?: number[];
    observedSpellIds?: number[];
  } = {},
): AbilityCapabilityResolution {
  if (isObserved(rule, options.observedSpellIds)) {
    return { rule, state: "AVAILABLE", reason: "observed_usage" };
  }

  switch (rule.availability) {
    case "BASELINE":
    case "SHARED":
    case "FORM_DEPENDENT":
    case "PET_DEPENDENT":
      return { rule, state: "AVAILABLE", reason: rule.availability.toLowerCase() };
    case "TALENT":
    case "CHOICE_NODE": {
      if (options.knownTalentSpellIds == null) {
        return { rule, state: "UNKNOWN", reason: "talent_data_unavailable" };
      }
      if (isTalentSatisfied(rule, options.knownTalentSpellIds)) {
        return { rule, state: "AVAILABLE", reason: "talent_selected" };
      }
      return { rule, state: "NOT_AVAILABLE", reason: "talent_not_selected" };
    }
    default:
      return { rule, state: "UNKNOWN", reason: "unknown_availability" };
  }
}

function aggregateCapabilityStates(
  category: AbilityCategory,
  resolutions: AbilityCapabilityResolution[],
  fallbackReason: string,
): ApplicableCategoryResult {
  if (resolutions.length === 0) {
    return {
      category,
      state: "not_applicable",
      reason: fallbackReason,
      rules: [],
    };
  }

  const available = resolutions.filter((r) => r.state === "AVAILABLE");
  if (available.length > 0) {
    return {
      category,
      state: "applicable",
      reason: available[0]!.reason,
      rules: available.map((r) => r.rule),
    };
  }

  const unknown = resolutions.filter((r) => r.state === "UNKNOWN");
  if (unknown.length > 0) {
    return {
      category,
      state: "uncertain",
      reason: unknown[0]!.reason,
      rules: unknown.map((r) => r.rule),
    };
  }

  return {
    category,
    state: "not_applicable",
    reason: resolutions[0]!.reason || "not_applicable",
    rules: resolutions.map((r) => r.rule),
  };
}

/**
 * Resolve run-scoped capabilities for every Utility-relevant catalog rule matching
 * class/spec/role. Spec restrictions are applied by the catalog filter before this.
 */
export function resolveUtilityAbilityCapabilities(
  options: GetApplicableOptions,
): AbilityCapabilityResolution[] {
  const resolved = resolveAbilityCatalog({
    classSlug: options.classSlug,
    specSlug: options.specSlug,
    role: options.role,
    gameVersion: options.gameVersion,
    includeShared: true,
    includeRacials: options.includeRacials ?? false,
  });
  if (!resolved.ok) return [];

  return resolved.catalog.rules.map((rule) =>
    resolveAbilityCapability(rule, {
      knownTalentSpellIds: options.knownTalentSpellIds,
      observedSpellIds: options.observedSpellIds,
    }),
  );
}

/**
 * Determines which ability categories are applicable for scoring a character.
 * Built from per-rule capability states (AVAILABLE / NOT_AVAILABLE / UNKNOWN).
 * Talent-only categories become uncertain when talent data is unavailable.
 * Observed spell IDs can promote UNKNOWN/NOT_AVAILABLE → AVAILABLE for that run.
 */
export function getApplicableAbilityCategories(
  options: GetApplicableOptions,
): ApplicableCategoryResult[] {
  const resolved = resolveAbilityCatalog({
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

    const resolutions = rules.map((rule) =>
      resolveAbilityCapability(rule, {
        knownTalentSpellIds: options.knownTalentSpellIds,
        observedSpellIds: options.observedSpellIds,
      }),
    );
    results.push(aggregateCapabilityStates(category, resolutions, "no_matching_availability"));
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
