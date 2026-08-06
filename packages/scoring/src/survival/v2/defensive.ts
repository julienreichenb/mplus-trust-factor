import { clamp } from "../../math.js";
import {
  SURVIVAL_V2_MODEL_CONFIG,
  type SurvivalV2ModelConfig,
} from "./constants.js";
import {
  scoreDefensiveResponseClass,
} from "./contextual.js";
import type {
  SurvivalV2ComponentResult,
  SurvivalV2DangerWindowFact,
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

function meanOrNull(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Phase 2 contextual defensive response over danger windows.
 * Falls back to Phase 1 activation volume when no contextual windows apply.
 */
export function scoreSurvivalV2Defensive(input: {
  activations: SurvivalV2DefensiveActivationFact;
  activeCombatDurationMs: number;
  dangerWindows?: SurvivalV2DangerWindowFact[];
  config?: SurvivalV2ModelConfig;
}): SurvivalV2ComponentResult {
  const config = input.config ?? SURVIVAL_V2_MODEL_CONFIG;
  const { activations, activeCombatDurationMs } = input;
  const windows = input.dangerWindows ?? [];

  const applicableToolkit = activations.toolkit.filter(
    (t) => isApplicableCategory(t.category, config) && PENALIZABLE_STATES.has(t.state),
  );

  const classCounts: Record<string, number> = {
    ANTICIPATED: 0,
    REACTIVE: 0,
    NO_RESPONSE_AVAILABLE: 0,
    NO_TOOL_AVAILABLE: 0,
    NOT_OBSERVABLE: 0,
  };
  const scored: number[] = [];
  let omittedNoTool = 0;
  let omittedNotObservable = 0;

  for (const w of windows) {
    const cls = w.defensiveResponseClass;
    if (!cls) continue;
    classCounts[cls] = (classCounts[cls] ?? 0) + 1;
    const score = scoreDefensiveResponseClass(cls);
    if (score == null) {
      if (cls === "NO_TOOL_AVAILABLE") omittedNoTool += 1;
      else omittedNotObservable += 1;
      continue;
    }
    scored.push(score);
  }

  if (scored.length > 0) {
    return {
      metricKey: config.metricKeys.defensive,
      state: "SCORED",
      score: clamp(meanOrNull(scored) ?? 0, 0, 100),
      weightUsed: 0,
      reason: null,
      evidence: {
        mode: "contextual_phase2",
        scoredWindowCount: scored.length,
        classCounts,
        omittedNoTool,
        omittedNotObservable,
        catalogCoverage: activations.catalogCoverage,
        note: "ANTICIPATED > REACTIVE > NO_RESPONSE_AVAILABLE; NO_TOOL_AVAILABLE omitted.",
      },
    };
  }

  if (windows.length > 0 && omittedNotObservable === windows.length) {
    return {
      metricKey: config.metricKeys.defensive,
      state: "UNAVAILABLE",
      score: null,
      weightUsed: 0,
      reason: "defensive_timing_not_observable",
      evidence: { classCounts, catalogCoverage: activations.catalogCoverage },
    };
  }

  if (windows.length > 0 && omittedNoTool + omittedNotObservable === windows.length) {
    return {
      metricKey: config.metricKeys.defensive,
      state: "NOT_APPLICABLE",
      score: null,
      weightUsed: 0,
      reason: "no_applicable_defensive_tool_at_danger",
      evidence: { classCounts, catalogCoverage: activations.catalogCoverage },
    };
  }

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

  // Phase 1 volume fallback when no danger windows require contextual scoring.
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
      mode: "volume_fallback",
      activationCount,
      activeCombatHours,
      activationsPerActiveCombatHour: rate,
      countedCategories: [...new Set(countedCategories)],
      catalogCoverage: activations.catalogCoverage,
      saturatingK: config.defensiveRate.saturatingK,
    },
  };
}
