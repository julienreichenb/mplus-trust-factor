import { createHash } from "node:crypto";
import { stableStringify } from "../../model-config/stable-hash.js";
import {
  computePerformanceV2,
  computePerformanceV2InputFingerprint,
  type PerformanceV2ComputeOptions,
} from "../v2/compute.js";
import {
  PERFORMANCE_PHASE2_ALGORITHM_VERSION,
  PERFORMANCE_PHASE2_MODEL_LABEL,
  PERFORMANCE_PHASE2_WEIGHTS,
} from "./constants.js";
import { combinePerformancePhase2Scores } from "./combine.js";
import { computePerformancePhase2Confidence } from "./confidence.js";
import { computeOffensiveCooldownDiscipline } from "./cooldown-discipline.js";
import type {
  PerformancePhase2ComputeInput,
  PerformancePhase2ComputeResult,
} from "./types.js";

export interface PerformancePhase2ComputeOptions {
  phase1?: PerformanceV2ComputeOptions;
  /** Override Phase 1 / cooldown combine weights (defaults = production 0.8 / 0.2). */
  combineWeights?: { phase1: number; cooldown: number };
}

export function computePerformancePhase2InputFingerprint(
  input: PerformancePhase2ComputeInput,
  options?: PerformancePhase2ComputeOptions,
): string {
  const phase1Fp = computePerformanceV2InputFingerprint(
    input.phase1,
    options?.phase1,
  );
  const cooldownPayload = [...input.cooldownRuns]
    .map((r) => ({
      slotId: r.slotId,
      reportCode: r.reportCode,
      fightId: r.fightId,
      reportRevision: r.reportRevision,
      participantActorId: r.participantActorId,
      classSlug: r.classSlug,
      specSlug: r.specSlug,
      catalogVersion: r.catalogVersion,
      activeCombatDurationMs: r.activeCombatDurationMs,
      activations: r.offensiveActivations.map((a) => ({
        canonicalKey: a.canonicalKey,
        primarySpellId: a.primarySpellId,
        timestampMs: a.timestampMs,
      })),
    }))
    .sort((a, b) => a.slotId.localeCompare(b.slotId));

  const weights = options?.combineWeights ?? PERFORMANCE_PHASE2_WEIGHTS;

  return createHash("sha256")
    .update(
      stableStringify({
        algorithmVersion: PERFORMANCE_PHASE2_ALGORITHM_VERSION,
        phase1Fingerprint: phase1Fp,
        cooldownRuns: cooldownPayload,
        weights,
      }),
    )
    .digest("hex");
}

/**
 * Provider-free Performance Phase 2.
 * Does not call providers, reselect runs, or mutate public snapshots.
 */
export function computePerformancePhase2(
  input: PerformancePhase2ComputeInput,
  options?: PerformancePhase2ComputeOptions,
): PerformancePhase2ComputeResult {
  const phase1 = computePerformanceV2(input.phase1, options?.phase1);
  const cooldown = computeOffensiveCooldownDiscipline(input.cooldownRuns);

  const combined = combinePerformancePhase2Scores(
    {
      phase1Score: phase1.score,
      cooldownScore: cooldown.score,
    },
    options?.combineWeights ?? PERFORMANCE_PHASE2_WEIGHTS,
  );

  // Inherit Phase 1 PARTIAL when Phase 1 itself was partial but combine is AVAILABLE.
  let state = combined.state;
  if (
    state === "AVAILABLE" &&
    (phase1.state === "PARTIAL" ||
      cooldown.cooldownUsableRunCount < cooldown.selectedRunCount)
  ) {
    state = "PARTIAL";
  }

  const confidenceResult = computePerformancePhase2Confidence({
    phase1Confidence: phase1.confidence,
    phase1Limits: (phase1.explanation.confidenceLimits ?? []) as string[],
    weightsApplied: combined.weightsApplied,
    cooldown,
    combinedScore: combined.score,
  });

  const limitations = [
    ...combined.limitations,
    ...confidenceResult.causes,
  ];
  if (phase1.state === "PARTIAL" && !limitations.includes("phase1_partial")) {
    limitations.push("phase1_partial");
  }

  const profileDungeonCount = input.phase1.profileAggregate
    ? input.phase1.profileAggregate.perDungeon.filter((d) =>
        input.phase1.manifest.activeDungeonSlugs.includes(d.dungeonSlug),
      ).length
    : 0;

  const coverage = {
    activeDungeonCount: input.phase1.manifest.activeDungeonSlugs.length,
    detailedDungeonCount: phase1.dungeons.length,
    selectedRunCount: input.phase1.runParseFacts.length,
    profileDungeonCount,
    cooldownUsableRunCount: cooldown.cooldownUsableRunCount,
    evaluatedAbilityCount: cooldown.evaluatedAbilityCount,
  };

  const contributors = [
    ...phase1.explanation.contributors,
    {
      key: "performance.phase1",
      value: phase1.score,
      weight: combined.weightsApplied.phase1,
      note: null,
    },
    {
      key: "performance.offensive_cooldown_discipline",
      value: cooldown.score,
      weight: combined.weightsApplied.cooldown,
      note:
        cooldown.score == null ? "cooldown_evidence_unavailable" : null,
    },
  ];

  const explanation = {
    ...phase1.explanation,
    algorithmVersion: PERFORMANCE_PHASE2_ALGORITHM_VERSION,
    modelLabel: PERFORMANCE_PHASE2_MODEL_LABEL,
    phase1Score: phase1.score,
    offensiveCooldownDiscipline: cooldown.score,
    weightsApplied: combined.weightsApplied,
    cooldown,
    phase2State: "ACTIVE" as const,
    phase3State: "DEFERRED_CRITICAL_MASS" as const,
    contributors,
    confidenceLimits: [...new Set(limitations)],
    confidenceBreakdown: confidenceResult.breakdown,
  };

  const inputFingerprint = computePerformancePhase2InputFingerprint(
    input,
    options,
  );

  const metrics: Record<string, unknown> = {
    ...phase1.metrics,
    algorithmVersion: PERFORMANCE_PHASE2_ALGORITHM_VERSION,
    modelLabel: PERFORMANCE_PHASE2_MODEL_LABEL,
    phase1Score: phase1.score,
    phase1AlgorithmVersion: phase1.algorithmVersion,
    offensiveCooldownDiscipline: cooldown.score,
    weightsApplied: combined.weightsApplied,
    coverage,
    cooldownUsableRunCount: cooldown.cooldownUsableRunCount,
    evaluatedAbilityCount: cooldown.evaluatedAbilityCount,
    unsupportedAbilityIds: cooldown.unsupportedAbilityIds,
    catalogueIncompatibleRuns: cooldown.catalogueIncompatibleRuns,
    runsWithoutValidDuration: cooldown.runsWithoutValidDuration,
    confidenceBreakdown: confidenceResult.breakdown,
    phase2State: "ACTIVE",
    phase3State: "DEFERRED_CRITICAL_MASS",
    publicationBlocked: true,
  };

  return {
    state,
    score: combined.score,
    confidence: confidenceResult.confidence,
    confidenceBreakdown: confidenceResult.breakdown,
    phase1Score: phase1.score,
    offensiveCooldownDiscipline: cooldown.score,
    weightsApplied: combined.weightsApplied,
    phase1,
    cooldown,
    detailedRuns: phase1.explanation.selectedRuns,
    dungeonScores: phase1.dungeons,
    profileSummary: input.phase1.profileAggregate,
    coverage,
    limitations: [...new Set(limitations)],
    calculatorVersion: PERFORMANCE_PHASE2_ALGORITHM_VERSION,
    algorithmVersion: PERFORMANCE_PHASE2_ALGORITHM_VERSION,
    modelLabel: PERFORMANCE_PHASE2_MODEL_LABEL,
    inputFingerprint,
    explanation,
    metrics,
    contributors,
  };
}
