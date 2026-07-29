import type { AbilityCatalog } from "@mplus/abilities";
import { redistributeWeights, scoreOutcomeFromDeaths } from "./survival-v1-logic.js";
import { median } from "./survival-calibration-logic.js";
import type { SurvivalCalibrationRun } from "./survival-calibration-types.js";
import { clusterWindowsByCandidateRule } from "./survival-v1_1-audit.js";
import type { SurvivalStandaloneV1_1Config } from "./survival-v1_1-config.js";
import { SURVIVAL_STANDALONE_V1_1_CONFIG } from "./survival-v1_1-config.js";
import {
  aggregateSurvivalV1_1,
  buildTimelineForRun,
  determineScoreMode,
  scoreSurvivalV1_1Run,
} from "./survival-v1_1-logic.js";
import type {
  ExplicitHealthSnapshot,
  HealthTimeline,
  MaxHpResolution,
  SurvivalV1_1DangerWindowAudit,
  SurvivalV1_1DungeonScore,
  SurvivalV1_1GlobalScore,
  SurvivalV1_1ReactionOpportunity,
  SurvivalV1_1RunScore,
  SurvivalV1_1ScoreMode,
} from "./survival-v1_1-types.js";
import {
  SURVIVAL_STANDALONE_V1_1_1_CONFIG,
  type SurvivalStandaloneV1_1_1Config,
} from "./survival-v1_1_1-config.js";
import {
  activeMaxHpAt,
  hardenMaxHpResolution,
  type HardenedMaxHpResolution,
} from "./survival-v1_1_1-maxhp.js";

export interface SurvivalV1_1_1RunScore extends SurvivalV1_1RunScore {
  pressureClusterCount: number;
  invalidOutlierCount: number;
  scoreMode: SurvivalV1_1ScoreMode;
  maxHpResolutionHardened: HardenedMaxHpResolution;
  /** Pre-cluster danger window count (V1.1 merge only). */
  preClusterDangerWindowCount: number;
}

export interface SurvivalV1_1_1DungeonScore extends SurvivalV1_1DungeonScore {
  medianPressureClusterCount: number | null;
}

export interface SurvivalV1_1_1GlobalScore extends SurvivalV1_1GlobalScore {
  totalPressureClusters: number;
  totalInvalidOutliers: number;
}

export interface ScoreSurvivalV1_1_1RunInput {
  run: SurvivalCalibrationRun;
  catalog: AbilityCatalog;
  classSlug: string | null;
  snapshots: ExplicitHealthSnapshot[];
  eventPagesComplete: boolean;
  darkPactActiveIntervals?: Array<{ start: number; end: number }>;
  config?: SurvivalStandaloneV1_1_1Config;
  /** When provided, skip rebuild (tests / callers with a prebuilt timeline). */
  healthTimeline?: HealthTimeline | null;
}

/** Map V1.1.1 config onto the V1.1 scorer shape (shared thresholds/weights). */
function toV1_1Config(config: SurvivalStandaloneV1_1_1Config): SurvivalStandaloneV1_1Config {
  return {
    ...SURVIVAL_STANDALONE_V1_1_CONFIG,
    weights: { ...config.weights },
    outcomeByDeaths: { ...config.outcomeByDeaths },
    danger: {
      ...SURVIVAL_STANDALONE_V1_1_CONFIG.danger,
      lowHpRatio: config.danger.lowHpRatio,
      rollingWindowMs: config.danger.rollingWindowMs,
      rollingDamageRatio: config.danger.rollingDamageRatio,
      largeHitRatio: config.danger.largeHitRatio,
      mergeGapMs: config.danger.mergeGapMs,
    },
    defensiveResponse: {
      castLookbackMs: config.defensiveResponse.castLookbackMs,
      castLookaheadMs: config.defensiveResponse.castLookaheadMs,
      applicableCategories: config.defensiveResponse.applicableCategories,
    },
    emergencyRecovery: { ...config.emergencyRecovery },
    reaction: { ...config.reaction },
    scoreMode: { ...config.scoreMode },
  };
}

function hardenedToMaxHpResolution(
  run: SurvivalCalibrationRun,
  hardened: HardenedMaxHpResolution,
): MaxHpResolution {
  return {
    runId: run.runId,
    reportCode: run.reportCode,
    fightId: run.fightId,
    dungeonSlug: run.dungeonSlug,
    maxHp: hardened.baselineMaxHp,
    maxHpSource: hardened.baselineSourcePath,
    maxHpConfidence: hardened.baselineConfidence,
    sourcePayloadPath: hardened.baselineSourcePath,
    corroboratingEventCount: hardened.corroboratingBaselineCount,
    allObservedMaxHpValues: hardened.classifiedSnapshots.map((c) => c.rawMaxHp),
    modalStableValue: hardened.baselineMaxHp,
    temporaryMaxHpValues: hardened.temporaryIntervals.map((i) => i.maxHp),
    conflictingValues: hardened.classifiedSnapshots
      .filter((c) => c.classification === "INVALID_OUTLIER")
      .map((c) => c.rawMaxHp),
    resolutionFailureReason: hardened.resolutionFailureReason,
  };
}

function extractDarkPactIntervals(
  run: SurvivalCalibrationRun,
  darkPactSpellId: number,
): Array<{ start: number; end: number }> {
  const intervals: Array<{ start: number; end: number }> = [];
  for (const usage of run.normalized.defensiveUsage) {
    if (usage.spellId !== darkPactSpellId) continue;
    const applies = usage.buffApplications
      .map((b) => b.timestamp)
      .filter((t): t is number => t != null)
      .sort((a, b) => a - b);
    const removes = usage.buffRemovals
      .map((b) => b.timestamp)
      .filter((t): t is number => t != null)
      .sort((a, b) => a - b);
    let ri = 0;
    for (const start of applies) {
      while (ri < removes.length && removes[ri]! < start) ri += 1;
      const end = ri < removes.length ? removes[ri]! : run.normalized.run.endTime;
      if (ri < removes.length) ri += 1;
      intervals.push({ start, end });
    }
  }
  return intervals;
}

function rescoreFromClusters(
  base: SurvivalV1_1RunScore,
  clusters: SurvivalV1_1DangerWindowAudit[][],
  deathCount: number,
): Pick<
  SurvivalV1_1RunScore,
  | "behavioralSurvivalScore"
  | "defensiveResponse"
  | "emergencyRecovery"
  | "weightsApplied"
  | "defensiveCounts"
  | "recoveryCounts"
> {
  let coveredDef = 0;
  let eligibleDef = 0;
  let coveredRec = 0;
  let eligibleRec = 0;

  const defensiveCounts = { ...base.defensiveCounts };
  const recoveryCounts = { ...base.recoveryCounts };
  // Reset scored counts — recompute from clusters (one credit each).
  for (const key of Object.keys(defensiveCounts) as Array<keyof typeof defensiveCounts>) {
    defensiveCounts[key] = 0;
  }
  for (const key of Object.keys(recoveryCounts) as Array<keyof typeof recoveryCounts>) {
    recoveryCounts[key] = 0;
  }

  for (const cluster of clusters) {
    const defCovered = cluster.some(
      (w) =>
        w.defensiveCoverageKind === "proactive" ||
        w.defensiveCoverageKind === "reactive" ||
        w.defensiveCoverageKind === "death_only",
    );
    const defEligible = cluster.some(
      (w) =>
        w.defensiveCoverageKind === "proactive" ||
        w.defensiveCoverageKind === "reactive" ||
        w.defensiveCoverageKind === "eligible_miss" ||
        w.defensiveCoverageKind === "death_only",
    );
    const defUnavailable = cluster.every(
      (w) =>
        w.defensiveCoverageKind === "unavailable" ||
        w.defensiveCoverageKind === "not_applicable",
    );
    const defInsufficient = !defEligible &&
      cluster.some((w) => w.defensiveCoverageKind === "insufficient_reaction_time");

    if (defEligible) {
      eligibleDef += 1;
      if (defCovered) {
        coveredDef += 1;
        const kind = cluster.find(
          (w) =>
            w.defensiveCoverageKind === "proactive" ||
            w.defensiveCoverageKind === "reactive" ||
            w.defensiveCoverageKind === "death_only",
        )!.defensiveCoverageKind;
        if (kind === "proactive" || kind === "reactive" || kind === "death_only") {
          defensiveCounts[kind] += 1;
        }
      } else {
        defensiveCounts.eligible_miss += 1;
      }
    } else if (defInsufficient) {
      defensiveCounts.insufficient_reaction_time += 1;
    } else if (defUnavailable) {
      defensiveCounts.unavailable += 1;
    }

    const recCovered = cluster.some((w) => w.recoveryCoverageKind === "covered");
    const recEligible = cluster.some(
      (w) =>
        w.recoveryCoverageKind === "covered" || w.recoveryCoverageKind === "eligible_miss",
    );
    if (recEligible) {
      eligibleRec += 1;
      if (recCovered) {
        coveredRec += 1;
        recoveryCounts.covered += 1;
      } else {
        recoveryCounts.eligible_miss += 1;
      }
    } else if (
      cluster.some((w) => w.recoveryCoverageKind === "death_only_health_context_unavailable")
    ) {
      recoveryCounts.death_only_health_context_unavailable += 1;
    } else if (
      cluster.some((w) => w.recoveryCoverageKind === "insufficient_reaction_time")
    ) {
      recoveryCounts.insufficient_reaction_time += 1;
    } else {
      recoveryCounts.not_applicable += 1;
    }
  }

  const outcomeOnlyScore = scoreOutcomeFromDeaths(deathCount);
  const defensiveResponse =
    eligibleDef === 0
      ? {
          state: "NOT_APPLICABLE" as const,
          score: null as number | null,
          weightUsed: 0,
          reason:
            clusters.length === 0
              ? base.maxHp == null
                ? "no_danger_windows_max_hp_unavailable"
                : "no_danger_windows"
              : "no_eligible_defensive_windows",
          evidence: { pressureClusterCount: clusters.length, defensiveCounts },
        }
      : {
          state: "SCORED" as const,
          score: (coveredDef / eligibleDef) * 100,
          weightUsed: 0,
          reason: null as string | null,
          evidence: {
            covered: coveredDef,
            eligible: eligibleDef,
            defensiveCounts,
            oneCreditPerCluster: true,
          },
        };

  const emergencyRecovery =
    eligibleRec === 0
      ? {
          state: "NOT_APPLICABLE" as const,
          score: null as number | null,
          weightUsed: 0,
          reason:
            recoveryCounts.death_only_health_context_unavailable > 0
              ? "death_only_health_context_unavailable"
              : "no_eligible_recovery_opportunities",
          evidence: { recoveryCounts, oneCreditPerCluster: true },
        }
      : {
          state: "SCORED" as const,
          score: (coveredRec / eligibleRec) * 100,
          weightUsed: 0,
          reason: null as string | null,
          evidence: {
            covered: coveredRec,
            eligible: eligibleRec,
            recoveryCounts,
            oneCreditPerCluster: true,
          },
        };

  const weights = redistributeWeights({
    outcome: true,
    defensive: defensiveResponse.state === "SCORED",
    recovery: emergencyRecovery.state === "SCORED",
  });
  defensiveResponse.weightUsed = weights.defensiveResponse;
  emergencyRecovery.weightUsed = weights.emergencyRecovery;

  const behavioralSurvivalScore =
    outcomeOnlyScore * weights.survivalOutcome +
    (defensiveResponse.score ?? 0) * weights.defensiveResponse +
    (emergencyRecovery.score ?? 0) * weights.emergencyRecovery;

  return {
    behavioralSurvivalScore,
    defensiveResponse,
    emergencyRecovery,
    weightsApplied: weights,
    defensiveCounts,
    recoveryCounts,
  };
}

/**
 * Score a single run with Survival V1.1.1:
 * hardened max HP, active max HP for danger detection, pressure-cluster credits.
 */
export function scoreSurvivalV1_1_1Run(input: ScoreSurvivalV1_1_1RunInput): {
  runScore: SurvivalV1_1_1RunScore;
  dangerWindows: SurvivalV1_1DangerWindowAudit[];
  pressureClusters: SurvivalV1_1DangerWindowAudit[][];
  reactionOpportunities: SurvivalV1_1ReactionOpportunity[];
  maxHpResolution: HardenedMaxHpResolution;
} {
  const config = input.config ?? SURVIVAL_STANDALONE_V1_1_1_CONFIG;
  const v11Config = toV1_1Config(config);
  const darkPactIntervals =
    input.darkPactActiveIntervals ??
    extractDarkPactIntervals(input.run, config.maxHp.darkPactSpellId);

  const hardened = hardenMaxHpResolution(input.snapshots, {
    playerActorId: input.run.playerActorId,
    darkPactActiveIntervals: darkPactIntervals,
    config,
  });

  const maxHpResolution = hardenedToMaxHpResolution(input.run, hardened);
  const baseline = hardened.baselineMaxHp;

  let timeline: HealthTimeline | null;
  if (input.healthTimeline !== undefined) {
    timeline = input.healthTimeline;
  } else if (baseline != null) {
    timeline = buildTimelineForRun(
      input.run,
      baseline,
      input.snapshots,
      input.eventPagesComplete,
    );
  } else {
    timeline = null;
  }

  const scored = scoreSurvivalV1_1Run({
    run: input.run,
    catalog: input.catalog,
    classSlug: input.classSlug,
    maxHpResolution,
    healthTimeline: timeline,
    eventPagesComplete: input.eventPagesComplete,
    config: v11Config,
    resolveMaxHp: (timestamp) => activeMaxHpAt(hardened, timestamp),
  });

  const clusters = clusterWindowsByCandidateRule(
    scored.dangerWindows,
    timeline,
    baseline,
    {
      mergeGapMs: config.danger.mergeGapMs,
      recoverAboveHpRatio: config.pressureCluster.recoverAboveHpRatio,
      stableRecoveryMs: config.pressureCluster.stableRecoveryMs,
    },
  );

  const rescored = rescoreFromClusters(
    scored.runScore,
    clusters,
    scored.runScore.deathCount,
  );

  const runScore: SurvivalV1_1_1RunScore = {
    ...scored.runScore,
    ...rescored,
    outcome: {
      ...scored.runScore.outcome,
      weightUsed: rescored.weightsApplied.survivalOutcome,
    },
    dangerWindowCount: scored.dangerWindows.length,
    dangerWindowIds: scored.dangerWindows.map((w) => w.windowId),
    pressureClusterCount: clusters.length,
    invalidOutlierCount: hardened.invalidOutlierCount,
    scoreMode: "FULL_BEHAVIORAL",
    maxHpResolutionHardened: hardened,
    preClusterDangerWindowCount: scored.dangerWindows.length,
  };

  // Per-run scoreMode is refined by aggregate; keep a local hint from coverage.
  if (baseline == null) {
    runScore.scoreMode = "OUTCOME_ONLY";
  } else if (!(timeline?.complete ?? false)) {
    runScore.scoreMode = "PARTIAL_BEHAVIORAL";
  }

  return {
    runScore,
    dangerWindows: scored.dangerWindows,
    pressureClusters: clusters,
    reactionOpportunities: scored.reactionOpportunities,
    maxHpResolution: hardened,
  };
}

export function aggregateSurvivalV1_1_1(
  runScores: SurvivalV1_1_1RunScore[],
  expectedDungeonSlugs: string[],
  scoreMode?: SurvivalV1_1ScoreMode,
): {
  perDungeon: SurvivalV1_1_1DungeonScore[];
  global: SurvivalV1_1_1GlobalScore;
} {
  const runsWithValidMaxHp = runScores.filter((r) => r.maxHp != null).length;
  const runsWithCompleteTimeline = runScores.filter((r) => r.healthTimelineComplete).length;
  const resolvedMode =
    scoreMode ??
    determineScoreMode(
      runsWithValidMaxHp,
      runsWithCompleteTimeline,
      runScores.length,
      toV1_1Config(SURVIVAL_STANDALONE_V1_1_1_CONFIG),
    );

  const base = aggregateSurvivalV1_1(runScores, expectedDungeonSlugs, resolvedMode);

  const perDungeon: SurvivalV1_1_1DungeonScore[] = base.perDungeon.map((d) => {
    const runs = runScores.filter((r) => r.dungeonSlug === d.dungeonSlug);
    const clusterCounts = runs.map((r) => r.pressureClusterCount);
    return {
      ...d,
      medianPressureClusterCount: clusterCounts.length ? median(clusterCounts) : null,
    };
  });

  return {
    perDungeon,
    global: {
      ...base.global,
      totalPressureClusters: runScores.reduce((s, r) => s + r.pressureClusterCount, 0),
      totalInvalidOutliers: runScores.reduce((s, r) => s + r.invalidOutlierCount, 0),
    },
  };
}

export {
  activeMaxHpAt,
  hardenMaxHpResolution,
};
