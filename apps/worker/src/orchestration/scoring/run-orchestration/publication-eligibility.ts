/**
 * Shadow publication-eligibility decision for Scoring V2 digest orchestration.
 * Never mutates the public score pointer — eligibility only.
 */
import { expectedEvidenceSlotCount } from "@mplus/contracts";
import type { RunOrchestrationResult } from "./orchestrator.js";

export interface PublicationEligibilityDecision {
  /**
   * True when all completeness / compatibility gates pass.
   * Does not imply the public score pointer will be mutated —
   * that requires SCORING_PUBLICATION_ENABLED (kept false here).
   */
  eligible: boolean;
  reasons: string[];
  /** Always false while SCORING_PUBLICATION_ENABLED remains off. */
  publicationEnabled: false;
  publicScorePointerMutated: false;
  checks: {
    manifestComplete: boolean;
    expectedSlotCount: number;
    selectedSlotCount: number;
    characterDigestCount: number;
    requiredCharacterDigests: number;
    cacheMisses: number;
    performanceOk: boolean;
    utilityOk: boolean;
    survivalOk: boolean;
    scoreModelIdPresent: boolean;
  };
}

export function evaluatePublicationEligibility(input: {
  result: RunOrchestrationResult;
  scoringModelId: string;
  /** Process env gate — must remain false in this workstream. */
  scoringV2PublicationEnabled: boolean;
  /** Optional active-season expected slot count (dungeonCount × 2). */
  expectedSlotCountFromSeason?: number;
  /** Score-model max evidence slots (default 16 for model v6). */
  scoreModelMaxEvidenceSlots?: number;
}): PublicationEligibilityDecision {
  const { result } = input;
  const expected =
    input.expectedSlotCountFromSeason ??
    (result.expectedSlotCount ||
      expectedEvidenceSlotCount(result.manifest.activeDungeonSlugs.length));
  const reasons: string[] = [];

  const maxSlots = input.scoreModelMaxEvidenceSlots ?? 16;
  const scoreModelShapeOk = expected <= maxSlots;
  if (!scoreModelShapeOk) {
    reasons.push("SCORE_MODEL_SEASON_SHAPE_INCOMPATIBLE");
  }

  if (input.scoringV2PublicationEnabled) {
    reasons.push("SCORING_PUBLICATION_ENABLED_unexpectedly_true");
  } else {
    reasons.push("SCORING_PUBLICATION_ENABLED_false");
  }

  const manifestComplete =
    !result.incomplete && result.selectedSlotCount === expected;
  if (!manifestComplete) {
    reasons.push("manifest_incomplete");
  }

  const characterDigestCount = result.characterDigests.length;
  if (characterDigestCount !== expected) {
    reasons.push("character_digest_count_mismatch");
  }

  if (result.cacheMisses.length > 0) {
    reasons.push("provider_evidence_cache_miss");
  }

  const performanceOk =
    result.dimensions.performance != null &&
    !result.dimensions.blocked.some((b) => b.dimension === "PERFORMANCE");
  const utilityOk =
    result.dimensions.utility != null &&
    !result.dimensions.blocked.some((b) => b.dimension === "UTILITY");
  const survivalOk =
    result.dimensions.survival != null &&
    !result.dimensions.blocked.some((b) => b.dimension === "SURVIVAL");

  if (!performanceOk) reasons.push("performance_incomplete");
  if (!utilityOk) reasons.push("utility_incomplete");
  if (!survivalOk) reasons.push("survival_incomplete");

  if (result.fightFailures.length > 0) {
    reasons.push("fight_processing_failures");
  }

  const scoreModelIdPresent =
    typeof input.scoringModelId === "string" && input.scoringModelId.length > 0;
  if (!scoreModelIdPresent) reasons.push("score_model_missing");

  const eligible =
    scoreModelShapeOk &&
    manifestComplete &&
    characterDigestCount === expected &&
    result.cacheMisses.length === 0 &&
    result.fightFailures.length === 0 &&
    performanceOk &&
    utilityOk &&
    survivalOk &&
    scoreModelIdPresent;

  if (eligible) {
    reasons.push("publication_eligibility_gate_passed");
  } else {
    reasons.push("not_publication_eligible");
  }

  return {
    eligible,
    reasons,
    publicationEnabled: false,
    publicScorePointerMutated: false,
    checks: {
      manifestComplete,
      expectedSlotCount: expected,
      selectedSlotCount: result.selectedSlotCount,
      characterDigestCount,
      requiredCharacterDigests: expected,
      cacheMisses: result.cacheMisses.length,
      performanceOk,
      utilityOk,
      survivalOk,
      scoreModelIdPresent,
    },
  };
}

/** True when diagnostics may persist an incomplete manifest (shadow only). */
export function allowIncompleteManifestDiagnostics(
  result: Pick<RunOrchestrationResult, "incomplete" | "selectedSlotCount">,
): boolean {
  return result.incomplete || result.selectedSlotCount > 0;
}
