/**
 * Observability snapshot for refresh orchestration.
 */

import type { SchedulerPlanResult } from "./refresh-scheduler.js";
import type { CostAggregation } from "./refresh-cost-ledger.js";
import type { CadenceTier } from "@mplus/config";

export interface RefreshObservabilitySnapshot {
  cohortSize: number;
  jobsSelected: number;
  jobsSkipped: number;
  jobsDeferred: number;
  nextResetAt: string | null;
  plannedWclPoints: number;
  consumedWclPoints: number | null;
  averageCostPerCharacter: number | null;
  cacheReuseRatio: number | null;
  estimatedCohortDurationHours: number;
  staleProfilesByTier: Record<CadenceTier, number>;
  schedulingLagSeconds: number | null;
  failureCount: number;
  regionDistribution: Record<string, number>;
  specDistribution: Record<string, number>;
  dryRun: boolean;
}

export function buildObservabilitySnapshot(input: {
  plan: SchedulerPlanResult;
  costs?: CostAggregation | null;
  schedulingLagSeconds?: number | null;
  failureCount?: number;
  consumedWclPoints?: number | null;
}): RefreshObservabilitySnapshot {
  const { plan } = input;
  const selected = plan.items.filter((i) => i.status === "PLANNED").length;
  const skipped = plan.items.filter((i) => i.status.startsWith("SKIPPED_")).length;
  const deferred = plan.items.filter((i) => i.status === "DEFERRED_RATE_LIMIT").length;

  const staleProfilesByTier: Record<CadenceTier, number> = { A: 0, B: 0, C: 0, D: 0 };
  for (const item of plan.items) {
    if (item.status === "PLANNED" || item.status === "DEFERRED_RATE_LIMIT") {
      staleProfilesByTier[item.cadenceTier] += 1;
    }
  }

  const cacheReuseRatio =
    input.costs && input.costs.cacheHits + input.costs.cacheMisses > 0
      ? input.costs.cacheHits / (input.costs.cacheHits + input.costs.cacheMisses)
      : null;

  const averageCostPerCharacter =
    selected > 0 ? plan.estimatedWclPoints / selected : input.costs?.totalEstimated ?? null;

  return {
    cohortSize: plan.items.length,
    jobsSelected: selected,
    jobsSkipped: skipped,
    jobsDeferred: deferred,
    nextResetAt: plan.budget?.resetAt ?? null,
    plannedWclPoints: plan.estimatedWclPoints,
    consumedWclPoints: input.consumedWclPoints ?? null,
    averageCostPerCharacter,
    cacheReuseRatio,
    estimatedCohortDurationHours: plan.estimatedCompletionHours,
    staleProfilesByTier,
    schedulingLagSeconds: input.schedulingLagSeconds ?? null,
    failureCount: input.failureCount ?? 0,
    regionDistribution: plan.regionDistribution,
    specDistribution: plan.specDistribution,
    dryRun: plan.dryRun,
  };
}
