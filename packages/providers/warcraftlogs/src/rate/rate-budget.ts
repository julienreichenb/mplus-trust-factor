import type { WclRateBudgetAction, WclRateBudgetDecision, WclRateLimitSnapshot } from "../types.js";

export interface RateBudgetConfig {
  warnPercent: number;
  deferPercent: number;
  stopPercent: number;
}

export function evaluateRateBudget(
  snapshot: WclRateLimitSnapshot,
  config: RateBudgetConfig,
): WclRateBudgetDecision {
  const utilizationPercent =
    snapshot.limitPerHour > 0
      ? (snapshot.pointsSpentThisHour / snapshot.limitPerHour) * 100
      : 0;

  let action: WclRateBudgetAction = "OK";
  if (utilizationPercent >= config.stopPercent) {
    action = "STOP";
  } else if (utilizationPercent >= config.deferPercent) {
    action = "DEFER";
  } else if (utilizationPercent >= config.warnPercent) {
    action = "WARN";
  }

  return { action, utilizationPercent, snapshot };
}

export function shouldDeferExpensiveWork(decision: WclRateBudgetDecision): boolean {
  return decision.action === "DEFER" || decision.action === "STOP";
}

export function parseRateLimitSnapshot(data: {
  limitPerHour: number;
  pointsSpentThisHour: number;
  pointsRemaining?: number;
  resetInSeconds?: number | null;
}): WclRateLimitSnapshot {
  const now = Date.now();
  const resetAt =
    data.resetInSeconds != null
      ? new Date(now + data.resetInSeconds * 1000).toISOString()
      : null;
  return {
    limitPerHour: data.limitPerHour,
    pointsSpentThisHour: data.pointsSpentThisHour,
    pointsRemaining:
      data.pointsRemaining ?? Math.max(0, data.limitPerHour - data.pointsSpentThisHour),
    resetAt,
    fetchedAt: new Date(now).toISOString(),
  };
}
