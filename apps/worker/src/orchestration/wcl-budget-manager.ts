/**
 * Centralized Warcraft Logs rate-budget manager.
 * Preflight once per batch; defer jobs when budget insufficient.
 */
import type { AppEnv } from "@mplus/config";

export interface WclRateLimitState {
  pointsRemaining: number;
  pointsLimit: number;
  resetAt: string;
  fetchedAt: string;
}

export interface WclBudgetDecision {
  allowed: boolean;
  reason: "OK" | "DEFERRED_RATE_LIMIT" | "CIRCUIT_OPEN";
  pointsRemaining: number;
  estimatedCost: number;
  safetyReserve: number;
  resetAt: string | null;
}

export interface WclOperationCostRecord {
  operation: string;
  dataset: string;
  estimatedCost: number;
  measuredCost: number;
  characterId?: string;
  reportCode?: string;
  fightId?: number;
  refreshReason?: string;
}

/** Default estimated costs per WCL operation (points). Calibrated from historical refreshes. */
export const DEFAULT_WCL_OPERATION_COSTS: Record<string, number> = {
  "rate_limit_preflight": 1,
  "discoverCharacterSummary": 5,
  "discoverCharacterRuns": 8,
  "getReportFightDetails": 15,
  "getReportMaster": 3,
  "survivalAnalysis": 20,
  "sharedEvidenceHostileCasts": 12,
  "sharedEvidenceDeaths": 6,
  "sharedEvidenceCasts": 10,
};

export interface WclBudgetManagerOptions {
  env: Pick<AppEnv, "WCL_RATE_DEFER_PERCENT" | "WCL_RATE_STOP_PERCENT">;
  /** Fraction of remaining points to keep as safety reserve (0–1). */
  safetyReserveFraction?: number;
  /** Historical cost overrides from completed refreshes. */
  historicalCosts?: Record<string, number>;
}

export class WclBudgetManager {
  private cachedState: WclRateLimitState | null = null;
  private consecutiveFailures = 0;
  private circuitOpenUntil: number | null = null;
  private readonly safetyReserveFraction: number;
  private readonly historicalCosts: Record<string, number>;

  constructor(private readonly options: WclBudgetManagerOptions) {
    this.safetyReserveFraction = options.safetyReserveFraction ?? 0.1;
    this.historicalCosts = { ...DEFAULT_WCL_OPERATION_COSTS, ...options.historicalCosts };
  }

  updateRateLimitState(state: WclRateLimitState): void {
    this.cachedState = state;
    this.consecutiveFailures = 0;
    this.circuitOpenUntil = null;
  }

  recordFailure(): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= 5) {
      this.circuitOpenUntil = Date.now() + 5 * 60_000;
    }
  }

  isCircuitOpen(nowMs = Date.now()): boolean {
    return this.circuitOpenUntil != null && nowMs < this.circuitOpenUntil;
  }

  estimateCost(operations: string[]): number {
    return operations.reduce((sum, op) => sum + (this.historicalCosts[op] ?? 10), 0);
  }

  estimateCharacterRefreshCost(params: {
    needsSummary: boolean;
    needsRunDiscovery: boolean;
    fightDetailCount: number;
    needsSurvivalAnalysis: boolean;
  }): number {
    const ops: string[] = ["rate_limit_preflight"];
    if (params.needsSummary) ops.push("discoverCharacterSummary");
    if (params.needsRunDiscovery) ops.push("discoverCharacterRuns");
    for (let i = 0; i < params.fightDetailCount; i++) {
      ops.push("getReportFightDetails");
    }
    if (params.needsSurvivalAnalysis) ops.push("survivalAnalysis");
    return this.estimateCost(ops);
  }

  /**
   * Preflight check before starting a costly character refresh.
   * pointsRemaining >= estimatedCost + safetyReserve
   */
  preflight(estimatedCost: number, nowMs = Date.now()): WclBudgetDecision {
    if (this.isCircuitOpen(nowMs)) {
      return {
        allowed: false,
        reason: "CIRCUIT_OPEN",
        pointsRemaining: this.cachedState?.pointsRemaining ?? 0,
        estimatedCost,
        safetyReserve: 0,
        resetAt: this.cachedState?.resetAt ?? null,
      };
    }

    const state = this.cachedState;
    if (!state) {
      // No cached state — allow but caller must fetch rate limit first.
      return {
        allowed: true,
        reason: "OK",
        pointsRemaining: Infinity,
        estimatedCost,
        safetyReserve: 0,
        resetAt: null,
      };
    }

    const deferThreshold =
      state.pointsLimit * (this.options.env.WCL_RATE_DEFER_PERCENT / 100);
    const safetyReserve = Math.max(
      state.pointsRemaining * this.safetyReserveFraction,
      1,
    );

    const allowed =
      state.pointsRemaining > deferThreshold &&
      state.pointsRemaining >= estimatedCost + safetyReserve;

    return {
      allowed,
      reason: allowed ? "OK" : "DEFERRED_RATE_LIMIT",
      pointsRemaining: state.pointsRemaining,
      estimatedCost,
      safetyReserve,
      resetAt: state.resetAt,
    };
  }

  recordMeasuredCost(record: WclOperationCostRecord): void {
    const key = record.operation;
    const prev = this.historicalCosts[key] ?? record.estimatedCost;
    // Exponential moving average for cost calibration.
    this.historicalCosts[key] = prev * 0.8 + record.measuredCost * 0.2;
  }

  /** Consume planned points from the cached rate-limit state (batch accounting). */
  consumePoints(points: number): void {
    if (!this.cachedState || !Number.isFinite(points) || points <= 0) return;
    this.cachedState = {
      ...this.cachedState,
      pointsRemaining: Math.max(0, this.cachedState.pointsRemaining - points),
    };
  }

  getRateLimitState(): WclRateLimitState | null {
    return this.cachedState;
  }

  /**
   * Admin / premium callers must still pass through preflight.
   * This helper documents the invariant and always applies the same gate.
   */
  preflightWithGlobalSafety(
    estimatedCost: number,
    _actor: { isAdmin?: boolean; isPremium?: boolean } = {},
    nowMs = Date.now(),
  ): WclBudgetDecision {
    void _actor;
    return this.preflight(estimatedCost, nowMs);
  }
}

export function createWclBudgetManager(options: WclBudgetManagerOptions): WclBudgetManager {
  return new WclBudgetManager(options);
}
