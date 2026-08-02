import {
  SURVIVAL_V2_MODEL_CONFIG,
  type SurvivalV2ModelConfig,
} from "./constants.js";
import type { SurvivalV2ComponentResult } from "./types.js";

/** Map attributed deaths to outcome score (V1 parity). */
export function scoreSurvivalV2Outcome(
  deathCount: number,
  config: SurvivalV2ModelConfig = SURVIVAL_V2_MODEL_CONFIG,
): SurvivalV2ComponentResult {
  const count = Math.max(0, Math.floor(deathCount));
  const table = config.outcomeByDeaths;
  let score: number;
  if (count <= 0) score = table[0];
  else if (count === 1) score = table[1];
  else if (count === 2) score = table[2];
  else score = table.threeOrMore;

  return {
    metricKey: config.metricKeys.outcome,
    state: "SCORED",
    score,
    weightUsed: 0,
    reason: null,
    evidence: { deathCount: count },
  };
}
