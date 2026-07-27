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
  /** Live GraphQL field. */
  pointsResetIn?: number | null;
  /** Legacy fixture alias for pointsResetIn. */
  resetInSeconds?: number | null;
}): WclRateLimitSnapshot {
  const now = Date.now();
  const resetInSeconds = data.pointsResetIn ?? data.resetInSeconds ?? null;
  const resetAt =
    resetInSeconds != null ? new Date(now + resetInSeconds * 1000).toISOString() : null;
  return {
    limitPerHour: data.limitPerHour,
    pointsSpentThisHour: data.pointsSpentThisHour,
    pointsRemaining:
      data.pointsRemaining ?? Math.max(0, data.limitPerHour - data.pointsSpentThisHour),
    resetAt,
    fetchedAt: new Date(now).toISOString(),
  };
}
