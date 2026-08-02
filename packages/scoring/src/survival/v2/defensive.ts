import { clamp } from "../../math.js";
import {
  SURVIVAL_V2_MODEL_CONFIG,
  type SurvivalV2ModelConfig,
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

function isApplicableCategory(
  category: string,
  config: SurvivalV2ModelConfig,
): category is SurvivalV2DefensiveCategory {
  return (config.defensiveRate.applicableCategories as readonly string[]).includes(
    category,
  );
}

/**
 * Saturating map: observed activations/active-combat-hour → 0–100.
 * score = 100 * (1 - exp(-k * rate))
 */
export function saturatingDefensiveRateScore(
  activationsPerActiveCombatHour: number,
  config: SurvivalV2ModelConfig = SURVIVAL_V2_MODEL_CONFIG,
): number {
  const rate = Math.max(0, activationsPerActiveCombatHour);
  const k = config.defensiveRate.saturatingK;
  return clamp(100 * (1 - Math.exp(-k * rate)), 0, 100);
}

/**
 * Defensive activation volume normalized by active combat, gated by toolkit.
 * Does not claim timing quality (Phase 2). Catalog gaps lower confidence upstream.
 */
export function scoreSurvivalV2Defensive(input: {
  activations: SurvivalV2DefensiveActivationFact;
  activeCombatDurationMs: number;
  config?: SurvivalV2ModelConfig;
}): SurvivalV2ComponentResult {
  const config = input.config ?? SURVIVAL_V2_MODEL_CONFIG;
  const { activations, activeCombatDurationMs } = input;

  const applicableToolkit = activations.toolkit.filter(
    (t) => isApplicableCategory(t.category, config) && PENALIZABLE_STATES.has(t.state),
  );

  if (applicableToolkit.length === 0) {
    const unknownOnly = activations.toolkit.some(
      (t) => isApplicableCategory(t.category, config) && t.state === "UNKNOWN",
    );
    return {
      metricKey: config.metricKeys.defensive,
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
      metricKey: config.metricKeys.defensive,
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
    if (!isApplicableCategory(entry.category, config)) continue;
    const n = activations.byCategory[entry.category] ?? 0;
    activationCount += n;
    countedCategories.push(entry.category);
  }

  const activeCombatHours = activeCombatDurationMs / 3_600_000;
  const rate = activationCount / activeCombatHours;
  const score = saturatingDefensiveRateScore(rate, config);

  return {
    metricKey: config.metricKeys.defensive,
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
      saturatingK: config.defensiveRate.saturatingK,
    },
  };
}
