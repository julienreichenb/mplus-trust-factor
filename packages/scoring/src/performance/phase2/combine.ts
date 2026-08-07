/**
 * Combine Phase 1 + offensive cooldown discipline into Performance Phase 2.
 */

import { clamp } from "../../math.js";
import { PERFORMANCE_PHASE2_WEIGHTS } from "./constants.js";
import type { PerformancePhase2WeightsApplied } from "./types.js";

export interface PerformancePhase2CombineWeights {
  phase1: number;
  cooldown: number;
}

export function combinePerformancePhase2Scores(
  input: {
    phase1Score: number | null;
    cooldownScore: number | null;
  },
  combineWeights: PerformancePhase2CombineWeights = PERFORMANCE_PHASE2_WEIGHTS,
): {
  score: number | null;
  weightsApplied: PerformancePhase2WeightsApplied;
  state: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";
  limitations: string[];
} {
  const phase1Ok =
    input.phase1Score != null && Number.isFinite(input.phase1Score);
  const cooldownOk =
    input.cooldownScore != null && Number.isFinite(input.cooldownScore);

  if (!phase1Ok) {
    return {
      score: null,
      weightsApplied: { phase1: 0, cooldown: 0 },
      state: "UNAVAILABLE",
      limitations: [
        "phase1_unavailable",
        ...(cooldownOk ? ["cooldown_preserved_without_phase1"] : []),
      ],
    };
  }

  if (!cooldownOk) {
    return {
      score: clamp(input.phase1Score!, 0, 100),
      weightsApplied: { phase1: 1, cooldown: 0 },
      state: "PARTIAL",
      limitations: ["cooldown_evidence_unavailable"],
    };
  }

  const score =
    combineWeights.phase1 * input.phase1Score! +
    combineWeights.cooldown * input.cooldownScore!;

  return {
    score: clamp(score, 0, 100),
    weightsApplied: {
      phase1: combineWeights.phase1,
      cooldown: combineWeights.cooldown,
    },
    state: "AVAILABLE",
    limitations: [],
  };
}
