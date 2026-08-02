import { SURVIVAL_V2_DANGER, SURVIVAL_V2_METRIC_KEYS } from "./constants.js";
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
  },
): SurvivalV2DangerWindowFact[] {
  if (options?.alreadyMerged) return windows.map(cloneWindow);
  if (windows.length === 0) return [];

  const mergeGapMs = options?.mergeGapMs ?? SURVIVAL_V2_DANGER.mergeGapMs;
  const continuousGapMs =
    options?.continuousPressureGapMs ?? SURVIVAL_V2_DANGER.continuousPressureGapMs;
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
  };
}

/**
 * Emergency recovery coverage over eligible pressure clusters.
 * No eligible window → NOT_APPLICABLE (never score 100 by absence).
 * Never assumes potion availability from unused consumables.
 */
export function scoreSurvivalV2EmergencyRecovery(input: {
  clusters: SurvivalV2DangerWindowFact[];
  selfHealCatalogCoverage?: number;
}): SurvivalV2ComponentResult {
  const { clusters } = input;

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
      metricKey: SURVIVAL_V2_METRIC_KEYS.recovery,
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
    metricKey: SURVIVAL_V2_METRIC_KEYS.recovery,
    state: "SCORED",
    score: (useful / eligible) * 100,
    weightUsed: 0,
    reason: null,
    evidence: {
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
