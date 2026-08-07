import {
  SURVIVAL_V2_MODEL_CONFIG,
  type SurvivalV2ModelConfig,
} from "./constants.js";
import type {
  SurvivalV2ComponentResult,
  SurvivalV2DeathFact,
} from "./types.js";

/** Map attributed deaths to outcome score (V1 parity). Missing evidence ≠ zero deaths. */
export function scoreSurvivalV2Outcome(
  deathCountOrFact: number | SurvivalV2DeathFact,
  config: SurvivalV2ModelConfig = SURVIVAL_V2_MODEL_CONFIG,
): SurvivalV2ComponentResult {
  if (typeof deathCountOrFact === "object") {
    if (deathCountOrFact.evidenceState === "MISSING") {
      return {
        metricKey: config.metricKeys.outcome,
        state: "UNAVAILABLE",
        score: null,
        weightUsed: 0,
        reason: "death_evidence_missing",
        evidence: {
          deathCount: null,
          evidenceState: "MISSING",
          note: "Missing death dataset is not treated as zero observed deaths.",
        },
      };
    }
  }

  const count = Math.max(
    0,
    Math.floor(
      typeof deathCountOrFact === "number"
        ? deathCountOrFact
        : deathCountOrFact.count,
    ),
  );
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
    evidence: {
      deathCount: count,
      evidenceState:
        typeof deathCountOrFact === "object"
          ? (deathCountOrFact.evidenceState ?? "OBSERVED")
          : "OBSERVED",
    },
  };
}
