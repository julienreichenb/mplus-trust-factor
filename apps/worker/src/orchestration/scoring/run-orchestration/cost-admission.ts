/**
 * Scoring V2 canary cost accounting and rate-budget admission.
 * Unknown point costs stay unknown or estimated — never coerced to zero when work ran.
 */
import {
  evaluateRateBudget,
  type RateBudgetConfig,
} from "@mplus/provider-warcraftlogs";
import type { WclRateLimitSnapshot } from "@mplus/provider-warcraftlogs";
import { CONSERVATIVE_POINTS_PER_CAPABILITY_FIGHT } from "./live-capability-adapter.js";

export type CostAdmissionAction = "OK" | "WARN" | "DEFER" | "STOP";

export interface FightCostEstimate {
  sourceFightKey: string;
  cacheStatus: "HIT" | "MISS";
  estimatedProviderCalls: number;
  estimatedPoints: number | null;
  pointsKnown: boolean;
}

export interface CanaryCostProjection {
  uniqueFightCount: number;
  cacheHits: number;
  cacheMisses: number;
  discoveryOverheadRequests: number;
  discoveryOverheadPoints: number | null;
  estimatedProviderCalls: number;
  /** Sum of measured+estimated; null components stay tracked separately. */
  estimatedPointsTotal: number | null;
  unknownPointComponents: number;
  fights: FightCostEstimate[];
  rateLimit: {
    snapshot: WclRateLimitSnapshot | null;
    snapshotIsProviderCall: boolean;
    action: CostAdmissionAction;
    utilizationPercent: number | null;
    projectedUtilizationPercent: number | null;
    pointsSpentBefore: number | null;
    pointsSpentAfterProjected: number | null;
    limitPerHour: number | null;
    resetAt: string | null;
    admission: "ALLOW" | "WARN_ALLOW" | "DEFER" | "STOP";
    reasons: string[];
  };
}

export interface BuildCanaryCostProjectionInput {
  fights: Array<{
    sourceFightKey: string;
    packageCacheHit: boolean;
    historicalMeasuredPoints?: number | null;
  }>;
  discoveryOverheadRequests?: number;
  discoveryOverheadPoints?: number | null;
  rateLimitSnapshot?: WclRateLimitSnapshot | null;
  /** True when the snapshot was obtained via a live GraphQL call. */
  rateLimitSnapshotIsProviderCall?: boolean;
  rateBudgetConfig: RateBudgetConfig;
  /** Emergency reserve fraction of hourly limit (default 0.2). */
  reserveRatio?: number;
}

export function buildCanaryCostProjection(
  input: BuildCanaryCostProjectionInput,
): CanaryCostProjection {
  const fights: FightCostEstimate[] = input.fights.map((f) => {
    if (f.packageCacheHit) {
      return {
        sourceFightKey: f.sourceFightKey,
        cacheStatus: "HIT",
        estimatedProviderCalls: 0,
        estimatedPoints: 0,
        pointsKnown: true,
      };
    }
    const measured = f.historicalMeasuredPoints;
    if (measured != null && Number.isFinite(measured)) {
      return {
        sourceFightKey: f.sourceFightKey,
        cacheStatus: "MISS",
        estimatedProviderCalls: 1,
        estimatedPoints: measured,
        pointsKnown: true,
      };
    }
    return {
      sourceFightKey: f.sourceFightKey,
      cacheStatus: "MISS",
      estimatedProviderCalls: 1,
      estimatedPoints: CONSERVATIVE_POINTS_PER_CAPABILITY_FIGHT,
      pointsKnown: false,
    };
  });

  const cacheHits = fights.filter((f) => f.cacheStatus === "HIT").length;
  const cacheMisses = fights.length - cacheHits;
  const discoveryOverheadRequests = input.discoveryOverheadRequests ?? 0;
  const discoveryOverheadPoints = input.discoveryOverheadPoints ?? null;

  let estimatedPointsTotal: number | null = 0;
  let unknownPointComponents = 0;
  for (const f of fights) {
    if (f.estimatedPoints == null) {
      unknownPointComponents += 1;
      estimatedPointsTotal = null;
    } else if (estimatedPointsTotal != null) {
      estimatedPointsTotal += f.estimatedPoints;
    }
  }
  if (discoveryOverheadPoints == null && discoveryOverheadRequests > 0) {
    unknownPointComponents += 1;
  } else if (
    estimatedPointsTotal != null &&
    discoveryOverheadPoints != null
  ) {
    estimatedPointsTotal += discoveryOverheadPoints;
  }

  const estimatedProviderCalls =
    fights.reduce((n, f) => n + f.estimatedProviderCalls, 0) +
    discoveryOverheadRequests;

  const snapshot = input.rateLimitSnapshot ?? null;
  const reasons: string[] = [];
  let action: CostAdmissionAction = "OK";
  let utilizationPercent: number | null = null;
  let projectedUtilizationPercent: number | null = null;
  let pointsSpentBefore: number | null = null;
  let pointsSpentAfterProjected: number | null = null;
  let limitPerHour: number | null = null;
  let resetAt: string | null = null;
  let admission: CanaryCostProjection["rateLimit"]["admission"] = "ALLOW";

  if (snapshot) {
    const decision = evaluateRateBudget(snapshot, input.rateBudgetConfig);
    action = decision.action;
    utilizationPercent = decision.utilizationPercent;
    pointsSpentBefore = snapshot.pointsSpentThisHour;
    limitPerHour = snapshot.limitPerHour;
    resetAt = snapshot.resetAt;

    const projectedSpend =
      (estimatedPointsTotal ??
        cacheMisses * CONSERVATIVE_POINTS_PER_CAPABILITY_FIGHT +
          (discoveryOverheadPoints ?? discoveryOverheadRequests * 1)) +
      snapshot.pointsSpentThisHour;
    pointsSpentAfterProjected = projectedSpend;
    projectedUtilizationPercent =
      snapshot.limitPerHour > 0
        ? (projectedSpend / snapshot.limitPerHour) * 100
        : null;

    if (action === "STOP") {
      admission = "STOP";
      reasons.push("rate_budget_STOP");
    } else if (action === "DEFER" && cacheMisses > 0) {
      admission = "DEFER";
      reasons.push("rate_budget_DEFER_cold_acquisition");
    } else if (action === "WARN") {
      if (
        projectedUtilizationPercent != null &&
        projectedUtilizationPercent >= input.rateBudgetConfig.deferPercent
      ) {
        admission = "DEFER";
        reasons.push("warn_projected_into_defer");
      } else {
        admission = "WARN_ALLOW";
        reasons.push("rate_budget_WARN_below_defer_projection");
      }
    } else {
      admission = "ALLOW";
    }

    const reserveRatio = input.reserveRatio ?? 0.2;
    if (
      admission !== "STOP" &&
      admission !== "DEFER" &&
      snapshot.limitPerHour > 0 &&
      cacheMisses > 0
    ) {
      const reserveFloor = snapshot.limitPerHour * reserveRatio;
      const estimatedCost =
        estimatedPointsTotal ??
        cacheMisses * CONSERVATIVE_POINTS_PER_CAPABILITY_FIGHT;
      if (snapshot.pointsRemaining - estimatedCost < reserveFloor) {
        admission = "DEFER";
        reasons.push("budget_reserve_floor");
      }
    }
  } else {
    reasons.push("rate_limit_snapshot_absent");
    if (cacheMisses > 0) {
      // Without a snapshot, cold live acquisition is not admitted for canary.
      admission = "DEFER";
      reasons.push("no_snapshot_blocks_cold_live");
    } else {
      admission = "ALLOW";
      reasons.push("provider_free_replay_allowed");
    }
  }

  // Provider-free replay always allowed regardless of rate state.
  if (cacheMisses === 0) {
    admission = "ALLOW";
    reasons.push("provider_free_replay");
  }

  return {
    uniqueFightCount: fights.length,
    cacheHits,
    cacheMisses,
    discoveryOverheadRequests,
    discoveryOverheadPoints,
    estimatedProviderCalls,
    estimatedPointsTotal,
    unknownPointComponents,
    fights,
    rateLimit: {
      snapshot,
      snapshotIsProviderCall: Boolean(input.rateLimitSnapshotIsProviderCall),
      action,
      utilizationPercent,
      projectedUtilizationPercent,
      pointsSpentBefore,
      pointsSpentAfterProjected,
      limitPerHour,
      resetAt,
      admission,
      reasons,
    },
  };
}

export function assertCostAdmissionAllowsLive(
  projection: CanaryCostProjection,
): void {
  const { admission } = projection.rateLimit;
  if (admission === "STOP" || admission === "DEFER") {
    throw Object.assign(
      new Error(`canary_cost_admission_refused:${admission}`),
      {
        code: "CANARY_COST_ADMISSION_REFUSED",
        admission,
        reasons: projection.rateLimit.reasons,
      },
    );
  }
}
