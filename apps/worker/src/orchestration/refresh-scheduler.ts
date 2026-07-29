/**
 * Checkpointed refresh scheduler with dry-run mode.
 * Does not activate recurring production schedules — callers must pass explicit mode
 * and respect REFRESH_SCHEDULER_ENABLED / REFRESH_DRY_RUN_ONLY.
 */

import type { RefreshPolicyConfig, CadenceTier } from "@mplus/config";
import { assignCadenceTier, freshnessTtlMsForTier } from "@mplus/config";
import {
  selectCohort,
  buildScheduledRefreshJobKey,
  type CohortCandidate,
  type CohortSelectorConfig,
  type CohortDenominator,
} from "./cohort-selector.js";
import { applyFairnessCaps, type FairnessConfig } from "./cohort-fairness.js";
import { planDatasetRefresh, type RefreshReason } from "./dataset-refresh-planner.js";
import {
  WclBudgetManager,
  type WclBudgetDecision,
  type WclRateLimitState,
} from "./wcl-budget-manager.js";
import { BASELINE_COST_SCENARIOS } from "./refresh-cost-ledger.js";

export type SchedulerMode = "DRY_RUN" | "CACHED_BATCH" | "LIVE_ENQUEUE";

export interface SchedulerCheckpoint {
  cursor: number;
  processedCount: number;
  enqueuedCount: number;
  deferredCount: number;
  skippedCount: number;
  plannedWclPoints: number;
  consumedWclPoints: number;
  lastCharacterId: string | null;
}

export interface PlannedRefreshItem {
  characterId: string;
  region: string;
  specRole: string | null;
  cadenceTier: CadenceTier;
  deterministicJobKey: string;
  estimatedWclPoints: number;
  providerCallsRequired: boolean;
  modelRecalculationOnly: boolean;
  plannedDatasets: string[];
  status:
    | "PLANNED"
    | "SKIPPED_FRESH"
    | "SKIPPED_COOLDOWN"
    | "SKIPPED_BUDGET"
    | "SKIPPED_FAIRNESS"
    | "DEFERRED_RATE_LIMIT";
  skipReason?: string;
  deferredUntil?: string | null;
}

export interface SchedulerPlanResult {
  mode: SchedulerMode;
  dryRun: boolean;
  strategy: string;
  denominator: CohortDenominator | null;
  items: PlannedRefreshItem[];
  checkpoint: SchedulerCheckpoint;
  regionDistribution: Record<string, number>;
  specDistribution: Record<string, number>;
  estimatedWclPoints: number;
  estimatedCompletionHours: number;
  cadenceRecommendation: {
    dailyEligible: number;
    threeDayEligible: number;
    weeklyEligible: number;
    onDemandOnly: number;
    recommendedCadence: "daily" | "three_day" | "weekly" | "mixed";
    rationale: string;
  };
  budget: WclBudgetDecision | null;
  providerCalls: number;
  scoreMutations: number;
  notes: string[];
}

export interface RunSchedulerPlanInput {
  mode: SchedulerMode;
  policy: RefreshPolicyConfig;
  cohortConfig: CohortSelectorConfig;
  candidates: CohortCandidate[];
  budgetManager?: WclBudgetManager;
  rateLimitState?: WclRateLimitState | null;
  fairness?: FairnessConfig;
  checkpoint?: SchedulerCheckpoint;
  nowMs?: number;
  /** Characters currently within per-character cooldown. */
  cooldownCharacterIds?: Set<string>;
  /** Average points per character from measured ledger; falls back to warm_refresh baseline. */
  averageWclPointsPerCharacter?: number;
}

function emptyCheckpoint(): SchedulerCheckpoint {
  return {
    cursor: 0,
    processedCount: 0,
    enqueuedCount: 0,
    deferredCount: 0,
    skippedCount: 0,
    plannedWclPoints: 0,
    consumedWclPoints: 0,
    lastCharacterId: null,
  };
}

function recommendCadence(counts: {
  dailyEligible: number;
  threeDayEligible: number;
  weeklyEligible: number;
  estimatedDailyPoints: number;
  pointsLimit: number | null;
}): SchedulerPlanResult["cadenceRecommendation"] {
  const { dailyEligible, threeDayEligible, weeklyEligible, estimatedDailyPoints, pointsLimit } =
    counts;
  const onDemandOnly = Math.max(0, weeklyEligible); // placeholder; refined by caller tiers
  if (pointsLimit != null && estimatedDailyPoints > pointsLimit * 0.5) {
    return {
      dailyEligible,
      threeDayEligible,
      weeklyEligible,
      onDemandOnly,
      recommendedCadence: "weekly",
      rationale: "Estimated daily WCL points exceed half the hourly limit when scaled — prefer weekly until calibrated",
    };
  }
  if (dailyEligible > 0 && estimatedDailyPoints <= (pointsLimit ?? Infinity) * 0.25) {
    return {
      dailyEligible,
      threeDayEligible,
      weeklyEligible,
      onDemandOnly,
      recommendedCadence: "daily",
      rationale: "Elite daily cohort fits comfortably under measured budget headroom",
    };
  }
  if (threeDayEligible > 0) {
    return {
      dailyEligible,
      threeDayEligible,
      weeklyEligible,
      onDemandOnly,
      recommendedCadence: "three_day",
      rationale: "Strong/active cohort is viable every 3 days given current cost estimates",
    };
  }
  return {
    dailyEligible,
    threeDayEligible,
    weeklyEligible,
    onDemandOnly,
    recommendedCadence: "mixed",
    rationale: "Insufficient elite volume — use mixed tier cadences from policy config",
  };
}

/**
 * Plan a cohort refresh batch. Dry-run makes zero provider calls and zero score mutations.
 */
export function runSchedulerPlan(input: RunSchedulerPlanInput): SchedulerPlanResult {
  const nowMs = input.nowMs ?? Date.now();
  const notes: string[] = [];
  const dryRun = input.mode === "DRY_RUN" || input.policy.dryRunOnly || input.mode !== "LIVE_ENQUEUE";

  if (input.mode === "LIVE_ENQUEUE") {
    if (!input.policy.schedulerEnabled) {
      throw new Error("LIVE_ENQUEUE blocked: REFRESH_SCHEDULER_ENABLED is false");
    }
    if (input.policy.dryRunOnly) {
      throw new Error("LIVE_ENQUEUE blocked: REFRESH_DRY_RUN_ONLY is true");
    }
  }

  if (dryRun) {
    notes.push("Dry-run mode: zero provider calls, zero score writes, zero enqueue");
  }

  const avgPoints =
    input.averageWclPointsPerCharacter ??
    BASELINE_COST_SCENARIOS.find((s) => s.scenario === "warm_refresh")?.wclPoints ??
    35;

  // Resume from checkpoint cursor.
  const checkpoint = { ...(input.checkpoint ?? emptyCheckpoint()) };
  const remainingCandidates = input.candidates.slice(checkpoint.cursor);

  const cohort = selectCohort(input.cohortConfig, remainingCandidates, {
    nowMs,
    freshnessTtlMs: 86_400_000,
    wclBudgetAvailable: true,
    maxResults: input.policy.batchSize * 4,
  });

  const enriched = cohort.candidates.map((c) => {
    const tier = assignCadenceTier(
      {
        mythicRating: c.mythicRating,
        lastSeenAt: c.lastSeenAt,
        lastViewedAt: c.lastViewedAt,
        nowMs,
      },
      input.policy,
    );
    const ttl = freshnessTtlMsForTier(tier, input.policy);
    const fresh =
      ttl != null &&
      c.lastPublicRefreshAt != null &&
      nowMs - c.lastPublicRefreshAt.getTime() <= ttl;

    const plan = planDatasetRefresh({
      reason: dryRun ? "dry_run" : "scheduled_refresh",
      ratingStaleCombatFresh: false,
      modelChangedObservationsCompatible: false,
    });

    return {
      candidate: c,
      tier,
      fresh,
      plan,
      estimatedWclPoints: plan.modelRecalculationOnly ? 0 : avgPoints,
    };
  });

  let budgetDecision: WclBudgetDecision | null = null;
  if (input.budgetManager && input.rateLimitState) {
    input.budgetManager.updateRateLimitState(input.rateLimitState);
  }

  const fairnessInput = enriched
    .filter((e) => !e.fresh)
    .map((e) => ({
      characterId: e.candidate.characterId,
      region: e.candidate.region,
      specRole: e.candidate.specRole,
      priority: e.candidate.priority,
      estimatedWclPoints: e.estimatedWclPoints,
    }));

  const fairness = applyFairnessCaps(fairnessInput, input.policy.batchSize, input.fairness);
  const fairnessSkipped = new Set(fairness.skipped.map((s) => s.characterId));

  const items: PlannedRefreshItem[] = [];
  let plannedPoints = 0;
  let providerCalls = 0;

  for (const e of enriched) {
    const c = e.candidate;
    const jobKey = buildScheduledRefreshJobKey({
      characterId: c.characterId,
      cadenceTier: e.tier,
      strategy: input.cohortConfig.strategy,
      plannedDatasets: e.plan.datasetsToRefresh,
    });

    if (e.fresh) {
      items.push({
        characterId: c.characterId,
        region: c.region,
        specRole: c.specRole,
        cadenceTier: e.tier,
        deterministicJobKey: jobKey,
        estimatedWclPoints: 0,
        providerCallsRequired: false,
        modelRecalculationOnly: false,
        plannedDatasets: [],
        status: "SKIPPED_FRESH",
        skipReason: "already_fresh_for_tier",
      });
      checkpoint.skippedCount += 1;
      continue;
    }

    if (input.cooldownCharacterIds?.has(c.characterId)) {
      items.push({
        characterId: c.characterId,
        region: c.region,
        specRole: c.specRole,
        cadenceTier: e.tier,
        deterministicJobKey: jobKey,
        estimatedWclPoints: 0,
        providerCallsRequired: false,
        modelRecalculationOnly: false,
        plannedDatasets: e.plan.datasetsToRefresh,
        status: "SKIPPED_COOLDOWN",
        skipReason: "per_character_cooldown",
      });
      checkpoint.skippedCount += 1;
      continue;
    }

    if (fairnessSkipped.has(c.characterId)) {
      items.push({
        characterId: c.characterId,
        region: c.region,
        specRole: c.specRole,
        cadenceTier: e.tier,
        deterministicJobKey: jobKey,
        estimatedWclPoints: e.estimatedWclPoints,
        providerCallsRequired: e.plan.providerCallsRequired,
        modelRecalculationOnly: e.plan.modelRecalculationOnly,
        plannedDatasets: e.plan.datasetsToRefresh,
        status: "SKIPPED_FAIRNESS",
        skipReason: "region_or_spec_cap",
      });
      checkpoint.skippedCount += 1;
      continue;
    }

    // Only select fairness winners up to batch size with budget checks.
    if (!fairness.selected.some((s) => s.characterId === c.characterId)) {
      continue;
    }

    if (input.budgetManager) {
      const decision = input.budgetManager.preflight(plannedPoints + e.estimatedWclPoints, nowMs);
      budgetDecision = decision;
      if (!decision.allowed) {
        items.push({
          characterId: c.characterId,
          region: c.region,
          specRole: c.specRole,
          cadenceTier: e.tier,
          deterministicJobKey: jobKey,
          estimatedWclPoints: e.estimatedWclPoints,
          providerCallsRequired: e.plan.providerCallsRequired,
          modelRecalculationOnly: e.plan.modelRecalculationOnly,
          plannedDatasets: e.plan.datasetsToRefresh,
          status: "DEFERRED_RATE_LIMIT",
          skipReason: decision.reason,
          deferredUntil: decision.resetAt,
        });
        checkpoint.deferredCount += 1;
        notes.push(`Batch stopped before safety reserve at character ${c.characterId}`);
        // Stop accepting more budget-consuming work; remaining fairness picks also defer.
        continue;
      }
    }

    plannedPoints += e.estimatedWclPoints;
    if (e.plan.providerCallsRequired) providerCalls += 1;
    items.push({
      characterId: c.characterId,
      region: c.region,
      specRole: c.specRole,
      cadenceTier: e.tier,
      deterministicJobKey: jobKey,
      estimatedWclPoints: e.estimatedWclPoints,
      providerCallsRequired: e.plan.providerCallsRequired,
      modelRecalculationOnly: e.plan.modelRecalculationOnly,
      plannedDatasets: e.plan.datasetsToRefresh,
      status: "PLANNED",
    });
    checkpoint.enqueuedCount += 1;
    checkpoint.lastCharacterId = c.characterId;
  }

  checkpoint.processedCount = items.length;
  checkpoint.plannedWclPoints = plannedPoints;
  checkpoint.cursor = input.candidates.length;

  const regionDistribution: Record<string, number> = {};
  const specDistribution: Record<string, number> = {};
  let dailyEligible = 0;
  let threeDayEligible = 0;
  let weeklyEligible = 0;
  let onDemandOnly = 0;

  for (const item of items) {
    if (item.status === "PLANNED" || item.status === "DEFERRED_RATE_LIMIT") {
      regionDistribution[item.region] = (regionDistribution[item.region] ?? 0) + 1;
      const spec = item.specRole ?? "UNKNOWN";
      specDistribution[spec] = (specDistribution[spec] ?? 0) + 1;
    }
    if (item.cadenceTier === "A") dailyEligible += 1;
    else if (item.cadenceTier === "B") threeDayEligible += 1;
    else if (item.cadenceTier === "C") weeklyEligible += 1;
    else onDemandOnly += 1;
  }

  const spreadHours = Math.max(1, input.policy.spreadHours);
  const plannedCount = items.filter((i) => i.status === "PLANNED").length;

  return {
    mode: dryRun ? "DRY_RUN" : input.mode,
    dryRun,
    strategy: input.cohortConfig.strategy,
    denominator: cohort.denominator,
    items,
    checkpoint,
    regionDistribution,
    specDistribution,
    estimatedWclPoints: plannedPoints,
    estimatedCompletionHours: spreadHours * (plannedCount / Math.max(1, input.policy.batchSize)),
    cadenceRecommendation: {
      ...recommendCadence({
        dailyEligible,
        threeDayEligible,
        weeklyEligible,
        estimatedDailyPoints: dailyEligible * avgPoints,
        pointsLimit: input.rateLimitState?.pointsLimit ?? null,
      }),
      onDemandOnly,
    },
    budget: budgetDecision,
    providerCalls: dryRun ? 0 : providerCalls,
    scoreMutations: 0,
    notes,
  };
}

/** Resume deferred items after WCL reset — pure planner helper. */
export function resumeDeferredAfterReset(
  items: PlannedRefreshItem[],
  resetAtMs: number,
  nowMs = Date.now(),
): PlannedRefreshItem[] {
  if (nowMs < resetAtMs) return items;
  return items.map((item) => {
    if (item.status !== "DEFERRED_RATE_LIMIT") return item;
    return {
      ...item,
      status: "PLANNED",
      skipReason: undefined,
      deferredUntil: null,
    };
  });
}

export function coalesceDuplicateJobKeys(items: PlannedRefreshItem[]): PlannedRefreshItem[] {
  const seen = new Set<string>();
  const out: PlannedRefreshItem[] = [];
  for (const item of items) {
    if (seen.has(item.deterministicJobKey)) continue;
    seen.add(item.deterministicJobKey);
    out.push(item);
  }
  return out;
}

export type { RefreshReason };
