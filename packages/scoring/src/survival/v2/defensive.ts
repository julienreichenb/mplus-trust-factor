import { clamp } from "../../math.js";
import {
  SURVIVAL_V2_DEFENSIVE_RATE,
  SURVIVAL_V2_METRIC_KEYS,
} from "./constants.js";
import type {
  SurvivalV2ComponentResult,
  SurvivalV2DefensiveActivationFact,
  SurvivalV2DefensiveCategory,
} from "./types.js";

const PENALIZABLE_STATES = new Set([
  "AVAILABLE_CONFIRMED",
  "AVAILABLE_INFERRED",
]);

function isApplicableCategory(category: string): category is SurvivalV2DefensiveCategory {
  return (SURVIVAL_V2_DEFENSIVE_RATE.applicableCategories as readonly string[]).includes(
    category,
  );
}

/**
 * Saturating map: observed activations/active-combat-hour → 0–100.
 * score = 100 * (1 - exp(-k * rate))
 */
export function saturatingDefensiveRateScore(activationsPerActiveCombatHour: number): number {
  const rate = Math.max(0, activationsPerActiveCombatHour);
  const k = SURVIVAL_V2_DEFENSIVE_RATE.saturatingK;
  return clamp(100 * (1 - Math.exp(-k * rate)), 0, 100);
}

/**
 * Defensive activation volume normalized by active combat, gated by toolkit.
 * Does not claim timing quality (Phase 2). Catalog gaps lower confidence upstream.
 */
export function scoreSurvivalV2Defensive(input: {
  activations: SurvivalV2DefensiveActivationFact;
  activeCombatDurationMs: number;
}): SurvivalV2ComponentResult {
  const { activations, activeCombatDurationMs } = input;

  const applicableToolkit = activations.toolkit.filter(
    (t) => isApplicableCategory(t.category) && PENALIZABLE_STATES.has(t.state),
  );

  if (applicableToolkit.length === 0) {
    const unknownOnly = activations.toolkit.some(
      (t) => isApplicableCategory(t.category) && t.state === "UNKNOWN",
    );
    return {
      metricKey: SURVIVAL_V2_METRIC_KEYS.defensive,
      state: "NOT_APPLICABLE",
      score: null,
      weightUsed: 0,
      reason: unknownOnly ? "defensive_toolkit_unknown" : "no_applicable_defensive_toolkit",
      evidence: {
        toolkit: activations.toolkit,
        catalogCoverage: activations.catalogCoverage,
      },
    };
  }

  if (!(activeCombatDurationMs > 0)) {
    return {
      metricKey: SURVIVAL_V2_METRIC_KEYS.defensive,
      state: "UNAVAILABLE",
      score: null,
      weightUsed: 0,
      reason: "active_combat_duration_missing",
      evidence: { activeCombatDurationMs },
    };
  }

  let activationCount = 0;
  const countedCategories: string[] = [];
  for (const entry of applicableToolkit) {
    if (!isApplicableCategory(entry.category)) continue;
    const n = activations.byCategory[entry.category] ?? 0;
    activationCount += n;
    countedCategories.push(entry.category);
  }

  const activeCombatHours = activeCombatDurationMs / 3_600_000;
  const rate = activationCount / activeCombatHours;
  const score = saturatingDefensiveRateScore(rate);

  return {
    metricKey: SURVIVAL_V2_METRIC_KEYS.defensive,
    state: "SCORED",
    score,
    weightUsed: 0,
    reason: null,
    evidence: {
      activationCount,
      activeCombatHours,
      activationsPerActiveCombatHour: rate,
      countedCategories: [...new Set(countedCategories)],
      catalogCoverage: activations.catalogCoverage,
      saturatingK: SURVIVAL_V2_DEFENSIVE_RATE.saturatingK,
    },
  };
}
