import { describe, expect, it } from "vitest";
import { WclBudgetManager } from "./wcl-budget-manager.js";

describe("WclBudgetManager", () => {
  const manager = new WclBudgetManager({
    env: { WCL_RATE_DEFER_PERCENT: 80, WCL_RATE_STOP_PERCENT: 90 },
    safetyReserveFraction: 0.1,
  });

  it("defers when points remaining below estimated cost + reserve", () => {
    manager.updateRateLimitState({
      pointsRemaining: 20,
      pointsLimit: 100,
      resetAt: new Date(Date.now() + 3600_000).toISOString(),
      fetchedAt: new Date().toISOString(),
    });

    const decision = manager.preflight(25);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("DEFERRED_RATE_LIMIT");
  });

  it("allows when sufficient budget", () => {
    manager.updateRateLimitState({
      pointsRemaining: 90,
      pointsLimit: 100,
      resetAt: new Date(Date.now() + 3600_000).toISOString(),
      fetchedAt: new Date().toISOString(),
    });

    const decision = manager.preflight(10);
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe("OK");
  });

  it("opens circuit after repeated failures", () => {
    const circuitManager = new WclBudgetManager({
      env: { WCL_RATE_DEFER_PERCENT: 80, WCL_RATE_STOP_PERCENT: 90 },
    });
    for (let i = 0; i < 5; i++) circuitManager.recordFailure();
    expect(circuitManager.isCircuitOpen()).toBe(true);
    const decision = circuitManager.preflight(5);
    expect(decision.reason).toBe("CIRCUIT_OPEN");
  });
});
