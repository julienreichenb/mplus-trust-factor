import {
  SURVIVAL_V2_MODEL_CONFIG,
  type SurvivalV2ModelConfig,
} from "./constants.js";
import { scoreRecoveryResponseClass } from "./contextual.js";
import type {
  SurvivalV2ComponentResult,
  SurvivalV2DangerWindowFact,
} from "./types.js";

/**
 * Merge overlapping / nearby danger windows into pressure clusters (V1.1.1 concepts).
 * One credit per cluster — duplicate triggers inside a cluster do not multiply failures.
 */
export function mergePressureClusters(
  windows: SurvivalV2DangerWindowFact[],
  options?: {
    mergeGapMs?: number;
    continuousPressureGapMs?: number;
    alreadyMerged?: boolean;
    config?: SurvivalV2ModelConfig;
  },
): SurvivalV2DangerWindowFact[] {
  if (options?.alreadyMerged) return windows.map(cloneWindow);
  if (windows.length === 0) return [];

  const danger = (options?.config ?? SURVIVAL_V2_MODEL_CONFIG).danger;
  const mergeGapMs = options?.mergeGapMs ?? danger.mergeGapMs;
  const continuousGapMs =
    options?.continuousPressureGapMs ?? danger.continuousPressureGapMs;
  const gapLimit = Math.max(mergeGapMs, continuousGapMs);

  const sorted = [...windows].sort(
    (a, b) => a.startMs - b.startMs || a.endMs - b.endMs,
  );
  const clusters: SurvivalV2DangerWindowFact[] = [];
  let current = cloneWindow(sorted[0]!);

  for (let i = 1; i < sorted.length; i += 1) {
    const next = sorted[i]!;
    const gap = next.startMs - current.endMs;
    if (gap <= gapLimit) {
      current = mergeTwo(current, next);
    } else {
      clusters.push(current);
      current = cloneWindow(next);
    }
  }
  clusters.push(current);
  return clusters;
}

function cloneWindow(w: SurvivalV2DangerWindowFact): SurvivalV2DangerWindowFact {
  return {
    ...w,
    triggerTypes: [...w.triggerTypes],
  };
}

function mergeTwo(
  a: SurvivalV2DangerWindowFact,
  b: SurvivalV2DangerWindowFact,
): SurvivalV2DangerWindowFact {
  const triggers = [...new Set([...a.triggerTypes, ...b.triggerTypes])];
  const hpRank = { EXPLICIT: 3, RECONSTRUCTED: 2, PARTIAL: 1, MISSING: 0 } as const;
  const hpEvidenceQuality =
    hpRank[a.hpEvidenceQuality] >= hpRank[b.hpEvidenceQuality]
      ? a.hpEvidenceQuality
      : b.hpEvidenceQuality;

  const defensiveRank: Record<string, number> = {
    ANTICIPATED: 5,
    REACTIVE: 4,
    NO_RESPONSE_AVAILABLE: 3,
    NO_TOOL_AVAILABLE: 2,
    NOT_OBSERVABLE: 1,
  };
  const recoveryRank: Record<string, number> = {
    TIMELY_RECOVERY: 5,
    LATE_RECOVERY: 4,
    NO_RECOVERY_AVAILABLE: 3,
    NO_SELF_HEAL_AVAILABLE: 2,
    NOT_OBSERVABLE: 1,
  };
  const pickBest = <T extends string>(
    left: T | undefined,
    right: T | undefined,
    rank: Record<string, number>,
  ): T | undefined => {
    if (left == null) return right;
    if (right == null) return left;
    return (rank[left] ?? 0) >= (rank[right] ?? 0) ? left : right;
  };

  return {
    startMs: Math.min(a.startMs, b.startMs),
    endMs: Math.max(a.endMs, b.endMs),
    triggerTypes: triggers,
    hpEvidenceQuality,
    damageAmount:
      a.damageAmount != null || b.damageAmount != null
        ? (a.damageAmount ?? 0) + (b.damageAmount ?? 0)
        : null,
    recoveryUseful: Boolean(a.recoveryUseful || b.recoveryUseful),
    recoveryEligible: Boolean(a.recoveryEligible || b.recoveryEligible),
    deathOutcome: Boolean(a.deathOutcome || b.deathOutcome),
    availabilityState: a.availabilityState ?? b.availabilityState ?? null,
    defensiveResponseClass: pickBest(
      a.defensiveResponseClass,
      b.defensiveResponseClass,
      defensiveRank,
    ),
    recoveryResponseClass: pickBest(
      a.recoveryResponseClass,
      b.recoveryResponseClass,
      recoveryRank,
    ),
  };
}

/**
 * Emergency recovery — Phase 2 availability-aware when response classes present.
 * Legacy binary useful/eligible retained as fallback.
 */
export function scoreSurvivalV2EmergencyRecovery(input: {
  clusters: SurvivalV2DangerWindowFact[];
  selfHealCatalogCoverage?: number;
  config?: SurvivalV2ModelConfig;
}): SurvivalV2ComponentResult {
  const config = input.config ?? SURVIVAL_V2_MODEL_CONFIG;
  const { clusters } = input;

  const hasPhase2Classes = clusters.some((c) => c.recoveryResponseClass != null);
  if (hasPhase2Classes) {
    const classCounts: Record<string, number> = {
      TIMELY_RECOVERY: 0,
      LATE_RECOVERY: 0,
      NO_RECOVERY_AVAILABLE: 0,
      NO_SELF_HEAL_AVAILABLE: 0,
      NOT_OBSERVABLE: 0,
    };
    const scored: number[] = [];
    let omitted = 0;
    for (const cluster of clusters) {
      const cls = cluster.recoveryResponseClass;
      if (!cls) continue;
      classCounts[cls] = (classCounts[cls] ?? 0) + 1;
      const score = scoreRecoveryResponseClass(cls);
      if (score == null) {
        omitted += 1;
        continue;
      }
      scored.push(score);
    }

    if (scored.length === 0) {
      return {
        metricKey: config.metricKeys.recovery,
        state: "NOT_APPLICABLE",
        score: null,
        weightUsed: 0,
        reason:
          clusters.length === 0
            ? "no_danger_windows"
            : "no_eligible_recovery_opportunities",
        evidence: {
          mode: "contextual_phase2",
          pressureClusterCount: clusters.length,
          classCounts,
          omitted,
          selfHealCatalogCoverage: input.selfHealCatalogCoverage ?? null,
          note: "NO_SELF_HEAL_AVAILABLE / NOT_OBSERVABLE omitted (not failure).",
        },
      };
    }

    return {
      metricKey: config.metricKeys.recovery,
      state: "SCORED",
      score: (scored.reduce((a, b) => a + b, 0) / scored.length) * 1,
      weightUsed: 0,
      reason: null,
      evidence: {
        mode: "contextual_phase2",
        pressureClusterCount: clusters.length,
        scoredCount: scored.length,
        classCounts,
        omitted,
        oneCreditPerCluster: true,
        selfHealCatalogCoverage: input.selfHealCatalogCoverage ?? null,
        note: "TIMELY > LATE > NO_RECOVERY_AVAILABLE; unavailable self-heal omitted.",
      },
    };
  }

  let eligible = 0;
  let useful = 0;
  let skippedUnavailable = 0;
  let skippedMissingHealth = 0;

  for (const cluster of clusters) {
    if (cluster.availabilityState === "NOT_TALENTED_CONFIRMED") {
      skippedUnavailable += 1;
      continue;
    }
    if (cluster.availabilityState === "UNKNOWN") {
      skippedUnavailable += 1;
      continue;
    }
    if (
      cluster.hpEvidenceQuality === "MISSING" &&
      cluster.recoveryEligible !== true
    ) {
      skippedMissingHealth += 1;
      continue;
    }
    if (cluster.recoveryEligible !== true) continue;

    eligible += 1;
    if (cluster.recoveryUseful === true) useful += 1;
  }

  if (eligible === 0) {
    return {
      metricKey: config.metricKeys.recovery,
      state: "NOT_APPLICABLE",
      score: null,
      weightUsed: 0,
      reason:
        clusters.length === 0
          ? "no_danger_windows"
          : skippedMissingHealth > 0
            ? "no_eligible_recovery_health_context_unavailable"
            : "no_eligible_recovery_opportunities",
      evidence: {
        mode: "binary_fallback",
        pressureClusterCount: clusters.length,
        eligible: 0,
        useful: 0,
        skippedUnavailable,
        skippedMissingHealth,
        selfHealCatalogCoverage: input.selfHealCatalogCoverage ?? null,
        note: "Potions/healthstones are never assumed available from absence of use.",
      },
    };
  }

  return {
    metricKey: config.metricKeys.recovery,
    state: "SCORED",
    score: (useful / eligible) * 100,
    weightUsed: 0,
    reason: null,
    evidence: {
      mode: "binary_fallback",
      pressureClusterCount: clusters.length,
      eligible,
      useful,
      skippedUnavailable,
      skippedMissingHealth,
      oneCreditPerCluster: true,
      selfHealCatalogCoverage: input.selfHealCatalogCoverage ?? null,
      note: "Potions/healthstones are never assumed available from absence of use.",
    },
  };
}
