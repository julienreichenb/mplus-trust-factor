import { describe, expect, it } from "vitest";
import {
  bucketEstimatedWaitSeconds,
  computeObservedThroughput,
  computeRefreshEta,
  countQueuePosition,
  isRefreshJobAheadOf,
  REFRESH_ETA_DEFAULT_DURATION_SECONDS,
  REFRESH_ETA_HIGH_THROUGHPUT_SAMPLES,
  REFRESH_ETA_MIN_THROUGHPUT_SAMPLES,
  type RefreshEtaJobRef,
} from "./eta-compute.js";

function job(
  partial: Partial<RefreshEtaJobRef> & Pick<RefreshEtaJobRef, "id">,
): RefreshEtaJobRef {
  return {
    status: "QUEUED",
    priority: 0,
    scheduledAt: new Date("2026-08-01T12:00:00.000Z"),
    cancelRequestedAt: null,
    ...partial,
  };
}

function completions(count: number, nowMs: number, spacingMs = 60_000) {
  return Array.from({ length: count }, (_, i) => ({
    startedAt: new Date(nowMs - (count - i) * spacingMs - 90_000),
    completedAt: new Date(nowMs - (count - i) * spacingMs),
  }));
}

describe("refresh ETA compute", () => {
  const nowMs = Date.parse("2026-08-01T12:00:00.000Z");

  it("ACTIVE low-priority work always counts ahead of QUEUED high-priority (no overtake)", () => {
    const nowMs = Date.parse("2026-08-01T12:00:00.000Z");
    const activeLow = job({
      id: "active-low",
      status: "ACTIVE",
      priority: -10,
      scheduledAt: new Date(nowMs - 60_000),
    });
    const queuedHigh = job({
      id: "queued-high",
      status: "QUEUED",
      priority: 10,
      scheduledAt: new Date(nowMs),
    });

    expect(isRefreshJobAheadOf(activeLow, queuedHigh)).toBe(true);
    expect(isRefreshJobAheadOf(queuedHigh, activeLow)).toBe(false);

    const position = countQueuePosition(queuedHigh, [activeLow, queuedHigh]);
    expect(position).toBe(1);

    const result = computeRefreshEta({
      job: queuedHigh,
      eligibleInFlight: [activeLow, queuedHigh],
      recentCompletions: [],
      schedulingState: "RUNNING",
      activeRefreshCount: 1,
      globalConcurrencyLimit: 1,
      nowMs,
    });

    expect(result.queuePosition).toBe(1);
    expect(result.effectiveWorkerCapacity).toBe(0);
    // Must not claim zero wait while the only worker is occupied by ACTIVE work.
    expect(result.estimatedWaitSeconds).not.toBe(0);
    expect(result.estimatedWaitSeconds).toBeGreaterThan(0);
    expect(result.reason).toBe("occupied_duration_fallback");
  });

  it("buckets wait coarsely", () => {
    expect(bucketEstimatedWaitSeconds(0)).toBe(0);
    expect(bucketEstimatedWaitSeconds(12)).toBe(30);
    expect(bucketEstimatedWaitSeconds(90)).toBe(120);
    expect(bucketEstimatedWaitSeconds(400)).toBe(600);
  });

  it("orders by DB priority then scheduledAt without BullMQ priority", () => {
    const high = job({ id: "h", priority: 10, scheduledAt: new Date(nowMs) });
    const normal = job({ id: "n", priority: 0, scheduledAt: new Date(nowMs - 60_000) });
    const low = job({ id: "l", priority: -10, scheduledAt: new Date(nowMs - 120_000) });
    expect(isRefreshJobAheadOf(high, normal)).toBe(true);
    expect(isRefreshJobAheadOf(normal, high)).toBe(false);
    expect(isRefreshJobAheadOf(normal, low)).toBe(true);
    expect(isRefreshJobAheadOf(low, normal)).toBe(false);
  });

  it("counts approximate queue position priority-aware", () => {
    const target = job({ id: "t", priority: 0, scheduledAt: new Date(nowMs) });
    const aheadHigh = job({ id: "h", priority: 10, scheduledAt: new Date(nowMs + 1_000) });
    const aheadEarlier = job({ id: "e", priority: 0, scheduledAt: new Date(nowMs - 1_000) });
    const behind = job({ id: "b", priority: 0, scheduledAt: new Date(nowMs + 2_000) });
    const active = job({
      id: "a",
      status: "ACTIVE",
      priority: -10,
      scheduledAt: new Date(nowMs - 5_000),
    });
    const pos = countQueuePosition(target, [aheadHigh, aheadEarlier, behind, active, target]);
    expect(pos).toBe(3);
  });

  it("returns null wait + LOW when paused / draining / rate-limited / circuit-open", () => {
    for (const schedulingState of ["PAUSED", "DRAINING", "RATE_LIMITED", "CIRCUIT_OPEN"] as const) {
      const result = computeRefreshEta({
        job: job({ id: "t" }),
        eligibleInFlight: [job({ id: "t" })],
        recentCompletions: completions(REFRESH_ETA_HIGH_THROUGHPUT_SAMPLES, nowMs),
        schedulingState,
        activeRefreshCount: 0,
        globalConcurrencyLimit: 1,
        nowMs,
      });
      expect(result.estimatedWaitSeconds).toBeNull();
      expect(result.estimateConfidence).toBe("LOW");
      expect(result.schedulingState).toBe(schedulingState);
      expect(result.effectiveWorkerCapacity).toBe(0);
    }
  });

  it("returns null wait + LOW when WCL admit is blocked / snapshot stale", () => {
    const result = computeRefreshEta({
      job: job({ id: "t" }),
      eligibleInFlight: [job({ id: "t" })],
      recentCompletions: completions(REFRESH_ETA_HIGH_THROUGHPUT_SAMPLES, nowMs),
      schedulingState: "RUNNING",
      activeRefreshCount: 0,
      globalConcurrencyLimit: 1,
      wclAdmitBlocked: true,
      nowMs,
    });
    expect(result.estimatedWaitSeconds).toBeNull();
    expect(result.estimateConfidence).toBe("LOW");
    expect(result.reason).toBe("wcl_admit_blocked");
  });

  it("empty queue / active job with capacity → wait 0", () => {
    const active = job({ id: "a", status: "ACTIVE" });
    const result = computeRefreshEta({
      job: active,
      eligibleInFlight: [active],
      recentCompletions: completions(REFRESH_ETA_MIN_THROUGHPUT_SAMPLES, nowMs),
      schedulingState: "RUNNING",
      activeRefreshCount: 1,
      globalConcurrencyLimit: 1,
      nowMs,
    });
    expect(result.queuePosition).toBe(0);
    expect(result.estimatedWaitSeconds).toBe(0);
    expect(result.effectiveWorkerCapacity).toBe(0);
    expect(result.reason).toBe("already_active");
    expect(["MEDIUM", "HIGH"]).toContain(result.estimateConfidence);
  });

  it("one active + waiting jobs uses throughput when samples sufficient", () => {
    const active = job({ id: "a", status: "ACTIVE", scheduledAt: new Date(nowMs - 10_000) });
    const waiting = job({ id: "w", priority: 0, scheduledAt: new Date(nowMs) });
    const result = computeRefreshEta({
      job: waiting,
      eligibleInFlight: [active, waiting],
      recentCompletions: completions(REFRESH_ETA_HIGH_THROUGHPUT_SAMPLES, nowMs),
      schedulingState: "RUNNING",
      activeRefreshCount: 1,
      globalConcurrencyLimit: 1,
      nowMs,
    });
    expect(result.queuePosition).toBe(1);
    expect(result.activeRefreshCount).toBe(1);
    expect(result.effectiveWorkerCapacity).toBe(0);
    expect(result.observedThroughput).not.toBeNull();
    expect(result.estimatedWaitSeconds).not.toBeNull();
    expect(result.estimateConfidence).toBe("HIGH");
    // Never use activeRefreshCount alone as denominator — capacity is 0 here, throughput path used.
    expect(result.reason).toBe("throughput");
  });

  it("insufficient throughput samples → LOW or duration fallback MEDIUM", () => {
    const waiting = job({ id: "w" });
    const active = job({ id: "a", status: "ACTIVE", scheduledAt: new Date(nowMs - 1) });
    const thin = computeRefreshEta({
      job: waiting,
      eligibleInFlight: [active, waiting],
      recentCompletions: completions(1, nowMs),
      schedulingState: "RUNNING",
      activeRefreshCount: 0,
      globalConcurrencyLimit: 1,
      nowMs,
    });
    // capacity > 0 with thin samples uses duration fallback
    expect(thin.observedThroughput).toBeNull();
    expect(thin.estimatedWaitSeconds).not.toBeNull();
    expect(["LOW", "MEDIUM"]).toContain(thin.estimateConfidence);

    const none = computeRefreshEta({
      job: waiting,
      eligibleInFlight: [active, waiting],
      recentCompletions: [],
      schedulingState: "RUNNING",
      activeRefreshCount: 1,
      globalConcurrencyLimit: 1,
      nowMs,
    });
    // No free capacity: occupied-duration fallback (never zero wait while worker busy).
    expect(none.estimatedWaitSeconds).not.toBe(0);
    expect(none.estimatedWaitSeconds).toBeGreaterThan(0);
    expect(none.estimateConfidence).toBe("LOW");
    expect(none.reason).toBe("occupied_duration_fallback");
  });

  it("stable throughput yields MEDIUM then HIGH confidence", () => {
    const waiting = job({ id: "w" });
    const medium = computeRefreshEta({
      job: waiting,
      eligibleInFlight: [waiting, job({ id: "a", status: "ACTIVE", scheduledAt: new Date(nowMs - 1) })],
      recentCompletions: completions(REFRESH_ETA_MIN_THROUGHPUT_SAMPLES, nowMs),
      schedulingState: "RUNNING",
      activeRefreshCount: 1,
      globalConcurrencyLimit: 1,
      nowMs,
    });
    expect(medium.estimateConfidence).toBe("MEDIUM");

    const high = computeRefreshEta({
      job: waiting,
      eligibleInFlight: [waiting, job({ id: "a", status: "ACTIVE", scheduledAt: new Date(nowMs - 1) })],
      recentCompletions: completions(REFRESH_ETA_HIGH_THROUGHPUT_SAMPLES, nowMs),
      schedulingState: "RUNNING",
      activeRefreshCount: 1,
      globalConcurrencyLimit: 1,
      nowMs,
    });
    expect(high.estimateConfidence).toBe("HIGH");
  });

  it("low-priority jobs never claim HIGH confidence", () => {
    const low = job({ id: "l", priority: -10 });
    const result = computeRefreshEta({
      job: low,
      eligibleInFlight: [low, job({ id: "a", status: "ACTIVE", scheduledAt: new Date(nowMs - 1) })],
      recentCompletions: completions(REFRESH_ETA_HIGH_THROUGHPUT_SAMPLES, nowMs),
      schedulingState: "RUNNING",
      activeRefreshCount: 1,
      globalConcurrencyLimit: 1,
      nowMs,
    });
    expect(result.estimateConfidence).toBe("MEDIUM");
  });

  it("throughput helper requires minimum samples", () => {
    const thin = computeObservedThroughput({
      completions: completions(2, nowMs),
      windowSeconds: 900,
      nowMs,
    });
    expect(thin.throughputPerSecond).toBeNull();
    expect(thin.sampleCount).toBe(2);

    const ok = computeObservedThroughput({
      completions: completions(REFRESH_ETA_MIN_THROUGHPUT_SAMPLES, nowMs),
      windowSeconds: 900,
      nowMs,
    });
    expect(ok.throughputPerSecond).toBeGreaterThan(0);
    expect(ok.meanDurationSeconds).toBeGreaterThan(0);
  });

  it("duration fallback uses mean duration and capacity, not active count alone", () => {
    const waiting = job({ id: "w" });
    const result = computeRefreshEta({
      job: waiting,
      eligibleInFlight: [waiting],
      recentCompletions: [
        {
          startedAt: new Date(nowMs - 120_000),
          completedAt: new Date(nowMs - 30_000),
        },
      ],
      schedulingState: "RUNNING",
      activeRefreshCount: 0,
      globalConcurrencyLimit: 1,
      nowMs,
    });
    expect(result.effectiveWorkerCapacity).toBe(1);
    expect(result.observedThroughput).toBeNull();
    expect(result.estimatedWaitSeconds).toBe(
      bucketEstimatedWaitSeconds(0 * REFRESH_ETA_DEFAULT_DURATION_SECONDS),
    );
    // queuePosition 0 with capacity → ready path
    expect(result.estimatedWaitSeconds).toBe(0);
  });
});
