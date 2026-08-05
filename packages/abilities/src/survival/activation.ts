/**
 * Catalog-driven Survival activation projection.
 * Reuses shared classify/project helpers; Survival-specific rule filter + group keys.
 */
import { dimensionTagsForRule } from "../catalog/rule.js";
import {
  classifyActivationSignal,
  openingEventTypesForRule,
  projectCanonicalActivations,
  type ActivationSignalDisposition,
  type CanonicalOffensiveActivation,
  type OffensiveActivationEvent,
  type OffensiveActivationProjection,
} from "../offensive/activation.js";
import { getAllRegisteredRules } from "../registry.js";
import type { AbilityCategory, AbilityRule } from "../types.js";

const SURVIVAL_ACTIVATION_CATEGORIES = new Set<AbilityCategory>([
  "DEFENSIVE_MAJOR",
  "DEFENSIVE_MINOR",
  "IMMUNITY",
  "SELF_HEAL",
  "CONSUMABLE",
  "EXTERNAL_DEFENSIVE",
]);

export type SurvivalActivationEvent = OffensiveActivationEvent;
export type CanonicalSurvivalActivation = CanonicalOffensiveActivation;
export type SurvivalActivationProjection = OffensiveActivationProjection;

export function isSurvivalActivationRule(rule: AbilityRule): boolean {
  if (SURVIVAL_ACTIVATION_CATEGORIES.has(rule.category)) return true;
  const tags = dimensionTagsForRule(rule);
  return (
    tags.includes("SURVIVAL_PERSONAL_DEFENSIVE") ||
    tags.includes("SURVIVAL_RECOVERY")
  );
}

/**
 * Project Survival defensive / recovery / external-received evidence into
 * canonical uses (cast-primary, buff-primary, consumable, trigger-parent).
 */
export function projectSurvivalActivations(input: {
  events: SurvivalActivationEvent[];
  rules?: AbilityRule[];
  windowMs?: number;
}): SurvivalActivationProjection {
  const rules = (input.rules ?? getAllRegisteredRules()).filter(isSurvivalActivationRule);
  return projectCanonicalActivations({
    events: input.events,
    rules,
    windowMs: input.windowMs,
    groupKeyMode: "OWNER_OR_TARGET",
  });
}

export {
  classifyActivationSignal,
  openingEventTypesForRule,
  type ActivationSignalDisposition,
};
