/**
 * Performance Phase 2 confidence — blends Phase 1 evidence confidence with
 * offensive cooldown evidence coverage using the applied combine weights.
 *
 * Unresolved conditional talent CDs (skipped as non-applicable) must not lower
 * confidence. Incomplete usable-run coverage for scored cooldown evidence must.
 */

import { clamp01 } from "../../math.js";
import {
  buildDimensionConfidenceBreakdown,
  uniqueCauses,
  type DimensionConfidenceBreakdown,
} from "../../confidence/dimension-confidence.js";
import type { OffensiveCooldownDisciplineResult } from "./cooldown-discipline.js";
import type { PerformancePhase2WeightsApplied } from "./types.js";

export interface PerformancePhase2ConfidenceInput {
  phase1Confidence: number;
  phase1Limits: readonly string[];
  weightsApplied: PerformancePhase2WeightsApplied;
  cooldown: OffensiveCooldownDisciplineResult;
  combinedScore: number | null;
}

export interface PerformancePhase2ConfidenceResult {
  confidence: number;
  causes: string[];
  components: Record<string, number>;
  breakdown: DimensionConfidenceBreakdown;
}

export function computePerformancePhase2Confidence(
  input: PerformancePhase2ConfidenceInput,
): PerformancePhase2ConfidenceResult {
  if (input.combinedScore == null) {
    const causes = uniqueCauses([
      "performance_unavailable",
      ...input.phase1Limits,
    ]);
    const components = {
      phase1Confidence: clamp01(input.phase1Confidence),
      cooldownEvidenceConfidence: 0,
      phase1Weight: 0,
      cooldownWeight: 0,
      cooldownRunCoverage: 0,
    };
    return {
      confidence: 0,
      causes,
      components,
      breakdown: buildDimensionConfidenceBreakdown({
        value: 0,
        causes,
        components,
      }),
    };
  }

  const causes = uniqueCauses([...input.phase1Limits]);
  const selected = input.cooldown.selectedRunCount;
  const usable = input.cooldown.cooldownUsableRunCount;
  const cooldownRunCoverage =
    selected <= 0 ? 0 : clamp01(usable / Math.max(1, selected));

  const phase1Weight = Math.max(0, input.weightsApplied.phase1);
  const cooldownWeight = Math.max(0, input.weightsApplied.cooldown);
  const weightSum = phase1Weight + cooldownWeight;

  let cooldownEvidenceConfidence = 0;
  if (cooldownWeight <= 0) {
    // Score fell back to Phase 1 only — expose that cooldown did not contribute.
    causes.push("cooldown_evidence_unavailable");
    cooldownEvidenceConfidence = 0;
  } else {
    cooldownEvidenceConfidence = cooldownRunCoverage;
    if (usable < selected) {
      causes.push("incomplete_cooldown_run_coverage");
    }
    if (usable === 0) {
      causes.push("no_evaluable_cooldown_abilities");
    }
    if (input.cooldown.catalogueIncompatibleRuns.length > 0) {
      causes.push("cooldown_catalogue_incompatible_runs");
    }
    if (input.cooldown.runsWithoutValidDuration.length > 0) {
      causes.push("cooldown_invalid_duration_runs");
    }
    // Skipped talent/choice abilities (talent_availability_unknown, etc.) are
    // non-applicability — they do not reduce cooldownEvidenceConfidence.
  }

  const phase1Confidence = clamp01(input.phase1Confidence);
  const confidence =
    weightSum <= 0
      ? 0
      : clamp01(
          (phase1Weight * phase1Confidence +
            cooldownWeight * cooldownEvidenceConfidence) /
            weightSum,
        );

  const components = {
    phase1Confidence,
    cooldownEvidenceConfidence,
    phase1Weight,
    cooldownWeight,
    cooldownRunCoverage,
    selectedRunCount: selected,
    cooldownUsableRunCount: usable,
    evaluatedAbilityCount: input.cooldown.evaluatedAbilityCount,
  };

  const finalCauses = uniqueCauses(causes);
  return {
    confidence,
    causes: finalCauses,
    components,
    breakdown: buildDimensionConfidenceBreakdown({
      value: confidence,
      causes: finalCauses,
      components,
    }),
  };
}
