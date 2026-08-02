import {
  SURVIVAL_V2_METRIC_KEYS,
  SURVIVAL_V2_OUTCOME_BY_DEATHS,
} from "./constants.js";
import type { SurvivalV2ComponentResult } from "./types.js";

/** Map attributed deaths to outcome score (V1 parity). */
export function scoreSurvivalV2Outcome(deathCount: number): SurvivalV2ComponentResult {
  const count = Math.max(0, Math.floor(deathCount));
  let score: number;
  if (count <= 0) score = SURVIVAL_V2_OUTCOME_BY_DEATHS[0];
  else if (count === 1) score = SURVIVAL_V2_OUTCOME_BY_DEATHS[1];
  else if (count === 2) score = SURVIVAL_V2_OUTCOME_BY_DEATHS[2];
  else score = SURVIVAL_V2_OUTCOME_BY_DEATHS.threeOrMore;

  return {
    metricKey: SURVIVAL_V2_METRIC_KEYS.outcome,
    state: "SCORED",
    score,
    weightUsed: 0,
    reason: null,
    evidence: { deathCount: count },
  };
}
