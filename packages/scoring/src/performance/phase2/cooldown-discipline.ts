/**
 * Offensive cooldown discipline scoring (functional Performance Phase 2).
 * Counts activations already projected into digests — never recounts raw WCL.
 */

import type { ParticipantOffensiveActivationV1 } from "@mplus/contracts";
import {
  resolveEligibleOffensiveCooldowns,
  type CooldownEligibilitySkipReason,
} from "./eligibility.js";
import {
  computeExpectedUses,
  usageRatioToScore,
} from "./expected-uses.js";

export interface PerformanceCooldownRunEvidence {
  slotId: string;
  /** Raw-run identity for dedupe. */
  reportCode: string;
  fightId: number;
  reportRevision: number;
  participantActorId: number;
  classSlug: string | null;
  specSlug: string | null;
  catalogVersion: string;
  /** Canonical active-combat duration; null/≤0 → run omitted from cooldown. */
  activeCombatDurationMs: number | null;
  /** Projected activations from ParticipantScoringDigestV1.performance. */
  offensiveActivations: readonly ParticipantOffensiveActivationV1[];
}

export interface AbilityCooldownScore {
  canonicalKey: string;
  observedActivationCount: number;
  expectedUses: number;
  usageScore: number;
  effectiveCooldownMs: number;
  charges: number | null;
}

export interface RunCooldownDisciplineResult {
  slotId: string;
  runKey: string;
  score: number | null;
  evaluatedAbilities: AbilityCooldownScore[];
  skippedAbilityIds: string[];
  skipReasons: Array<{
    canonicalKey: string;
    reason: CooldownEligibilitySkipReason;
  }>;
  usable: boolean;
  omitReason:
    | null
    | "invalid_duration"
    | "no_evaluable_abilities"
    | "catalogue_incompatible";
}

export interface OffensiveCooldownDisciplineResult {
  score: number | null;
  selectedRunCount: number;
  cooldownUsableRunCount: number;
  eligibleAbilityCount: number;
  evaluatedAbilityCount: number;
  unsupportedAbilityIds: string[];
  catalogueIncompatibleRuns: string[];
  runsWithoutValidDuration: string[];
  runScores: RunCooldownDisciplineResult[];
}

function runKey(run: PerformanceCooldownRunEvidence): string {
  return [
    run.reportCode,
    String(run.fightId),
    String(run.reportRevision),
    String(run.participantActorId),
  ].join(":");
}

function countActivationsForKey(
  activations: readonly ParticipantOffensiveActivationV1[],
  canonicalKey: string,
): number {
  let n = 0;
  for (const a of activations) {
    if (a.canonicalKey === canonicalKey) n += 1;
  }
  return n;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

export function scoreRunCooldownDiscipline(
  run: PerformanceCooldownRunEvidence,
): RunCooldownDisciplineResult {
  const key = runKey(run);
  const duration = run.activeCombatDurationMs;
  if (duration == null || !(duration > 0) || !Number.isFinite(duration)) {
    return {
      slotId: run.slotId,
      runKey: key,
      score: null,
      evaluatedAbilities: [],
      skippedAbilityIds: [],
      skipReasons: [],
      usable: false,
      omitReason: "invalid_duration",
    };
  }

  const { eligible, skipped, catalogueIncompatible } =
    resolveEligibleOffensiveCooldowns({
      classSlug: run.classSlug,
      specSlug: run.specSlug,
      catalogVersion: run.catalogVersion,
    });

  if (catalogueIncompatible) {
    return {
      slotId: run.slotId,
      runKey: key,
      score: null,
      evaluatedAbilities: [],
      skippedAbilityIds: skipped.map((s) => s.canonicalKey),
      skipReasons: skipped,
      usable: false,
      omitReason: "catalogue_incompatible",
    };
  }

  const evaluatedAbilities: AbilityCooldownScore[] = [];
  for (const entry of eligible) {
    const observed = countActivationsForKey(
      run.offensiveActivations,
      entry.rule.canonicalKey,
    );
    const expectedUses = computeExpectedUses({
      activeCombatDurationMs: duration,
      effectiveCooldownMs: entry.effectiveCooldownMs,
      charges: entry.charges,
    });
    evaluatedAbilities.push({
      canonicalKey: entry.rule.canonicalKey,
      observedActivationCount: observed,
      expectedUses,
      usageScore: usageRatioToScore(observed, expectedUses),
      effectiveCooldownMs: entry.effectiveCooldownMs,
      charges: entry.charges,
    });
  }

  if (evaluatedAbilities.length === 0) {
    return {
      slotId: run.slotId,
      runKey: key,
      score: null,
      evaluatedAbilities: [],
      skippedAbilityIds: skipped.map((s) => s.canonicalKey),
      skipReasons: skipped,
      usable: false,
      omitReason: "no_evaluable_abilities",
    };
  }

  const score = mean(evaluatedAbilities.map((a) => a.usageScore));
  return {
    slotId: run.slotId,
    runKey: key,
    score,
    evaluatedAbilities,
    skippedAbilityIds: skipped.map((s) => s.canonicalKey),
    skipReasons: skipped,
    usable: score != null,
    omitReason: null,
  };
}

/**
 * Character-level offensive cooldown discipline: equal mean of usable runs.
 * Dedupes repeated digests for the same raw run + participant.
 */
export function computeOffensiveCooldownDiscipline(
  runs: readonly PerformanceCooldownRunEvidence[],
): OffensiveCooldownDisciplineResult {
  const seen = new Set<string>();
  const deduped: PerformanceCooldownRunEvidence[] = [];
  for (const run of runs) {
    const key = runKey(run);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(run);
  }

  const runScores = deduped.map(scoreRunCooldownDiscipline);
  const usable = runScores.filter((r) => r.usable && r.score != null);
  const unsupported = new Set<string>();
  const catalogueIncompatibleRuns: string[] = [];
  const runsWithoutValidDuration: string[] = [];
  let eligibleAbilityCount = 0;
  let evaluatedAbilityCount = 0;

  for (const r of runScores) {
    for (const id of r.skippedAbilityIds) unsupported.add(id);
    if (r.omitReason === "catalogue_incompatible") {
      catalogueIncompatibleRuns.push(r.slotId);
    }
    if (r.omitReason === "invalid_duration") {
      runsWithoutValidDuration.push(r.slotId);
    }
    if (r.usable) {
      eligibleAbilityCount = Math.max(
        eligibleAbilityCount,
        r.evaluatedAbilities.length + r.skippedAbilityIds.length,
      );
      evaluatedAbilityCount += r.evaluatedAbilities.length;
    }
  }

  // Prefer eligible count from first catalogue-compatible resolution.
  for (const run of deduped) {
    const { eligible, catalogueIncompatible } = resolveEligibleOffensiveCooldowns({
      classSlug: run.classSlug,
      specSlug: run.specSlug,
      catalogVersion: run.catalogVersion,
    });
    if (!catalogueIncompatible) {
      eligibleAbilityCount = eligible.length;
      break;
    }
  }

  return {
    score: mean(usable.map((r) => r.score!)),
    selectedRunCount: deduped.length,
    cooldownUsableRunCount: usable.length,
    eligibleAbilityCount,
    evaluatedAbilityCount,
    unsupportedAbilityIds: [...unsupported].sort(),
    catalogueIncompatibleRuns,
    runsWithoutValidDuration,
    runScores,
  };
}
