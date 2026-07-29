/**
 * Tests for batch WCL cost accounting — null costUnits and before/after delta.
 */
import { describe, expect, it } from "vitest";
import {
  formatPointsConsumed,
  measureBatchPointsDelta,
  resolveBatchCostAccounting,
  sumKnownRequestCosts,
  WclBatchCostTracker,
} from "./wcl-batch-cost-accounting.js";

describe("measureBatchPointsDelta", () => {
  it("measures points from before/after rateLimitData", () => {
    expect(
      measureBatchPointsDelta(
        { pointsSpentThisHour: 100 },
        { pointsSpentThisHour: 145 },
      ),
    ).toBe(45);
  });

  it("returns null when either snapshot is missing", () => {
    expect(measureBatchPointsDelta(null, { pointsSpentThisHour: 10 })).toBeNull();
    expect(measureBatchPointsDelta({ pointsSpentThisHour: 10 }, null)).toBeNull();
  });

  it("returns null on negative delta (hourly reset)", () => {
    expect(
      measureBatchPointsDelta(
        { pointsSpentThisHour: 3500 },
        { pointsSpentThisHour: 12 },
      ),
    ).toBeNull();
  });
});

describe("null costUnits handling", () => {
  it("counts null costUnits without treating them as zero contribution to known sum", () => {
    const { knownSum, knownCount, nullCount } = sumKnownRequestCosts([1, null, undefined, 4]);
    expect(knownSum).toBe(5);
    expect(knownCount).toBe(2);
    expect(nullCount).toBe(2);
  });

  it("uses estimated cost when all costUnits are null and no rateLimit delta", () => {
    const accounting = resolveBatchCostAccounting({
      before: null,
      after: null,
      perRequestCostUnits: [null, null, null],
      requestCount: 3,
      pageCount: 3,
    });
    expect(accounting.costSource).toBe("estimated");
    expect(accounting.pointsConsumed).toBe(3);
    expect(accounting.pointsConsumed).not.toBe(0);
    expect(formatPointsConsumed(accounting)).toBe("3 (estimated)");
  });

  it("never treats unknown as zero", () => {
    const accounting = resolveBatchCostAccounting({
      before: null,
      after: null,
      perRequestCostUnits: [],
      requestCount: 0,
      pageCount: 0,
      estimatedFallback: null,
    });
    expect(accounting.costSource).toBe("unknown");
    expect(accounting.pointsConsumed).toBeNull();
    expect(formatPointsConsumed(accounting)).toBe("unknown");
    // Callers must not coerce:
    expect(accounting.pointsConsumed ?? "UNKNOWN").toBe("UNKNOWN");
  });

  it("prefers measured batch delta over null per-request costUnits", () => {
    const accounting = resolveBatchCostAccounting({
      before: {
        limitPerHour: 3600,
        pointsSpentThisHour: 200,
        pointsRemaining: 3400,
        resetAt: null,
        fetchedAt: new Date().toISOString(),
      },
      after: {
        limitPerHour: 3600,
        pointsSpentThisHour: 290,
        pointsRemaining: 3310,
        resetAt: null,
        fetchedAt: new Date().toISOString(),
      },
      perRequestCostUnits: [null, null, null, null],
      requestCount: 90,
      pageCount: 90,
    });
    expect(accounting.costSource).toBe("measured");
    expect(accounting.pointsConsumed).toBe(90);
    expect(accounting.requestCount).toBe(90);
    expect(accounting.pageCount).toBe(90);
  });

  it("sums known costUnits as measured when every request reports cost", () => {
    const accounting = resolveBatchCostAccounting({
      before: null,
      after: null,
      perRequestCostUnits: [2, 3, 5],
      requestCount: 3,
      pageCount: 3,
    });
    expect(accounting.costSource).toBe("measured");
    expect(accounting.pointsConsumed).toBe(10);
  });
});

describe("WclBatchCostTracker", () => {
  it("aggregates request/page counts into finalize accounting", () => {
    const tracker = new WclBatchCostTracker();
    // Simulate begin without live client by setting via finalize path after manual records
    tracker.recordRequest(null, 2);
    tracker.recordRequest(null, 1);
    const accounting = tracker.finalize(10);
    expect(accounting.requestCount).toBe(2);
    expect(accounting.pageCount).toBe(3);
    expect(accounting.costSource).toBe("estimated");
    expect(accounting.pointsConsumed).toBe(10);
  });
});
