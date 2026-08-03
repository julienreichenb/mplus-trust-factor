import { afterEach, describe, expect, it, vi } from "vitest";
import { startEvidenceExportRecoverySweeper } from "./evidence-export-recovery.js";

describe("startEvidenceExportRecoverySweeper (N1)", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("reclaims once on start then schedules recursive ticks with batch limit", async () => {
    vi.useFakeTimers();
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([{ id: "stale-1" }])
      .mockResolvedValueOnce([])
      .mockResolvedValue([]);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const logger = { info: vi.fn(), warn: vi.fn() };
    const scheduledDelays: number[] = [];

    const sweeper = startEvidenceExportRecoverySweeper({
      prisma: { scoringV2EvidenceExport: { findMany, updateMany } } as never,
      logger: logger as never,
      intervalMs: 5_000,
      batchSize: 7,
      setTimeoutFn: ((fn: () => void, ms: number) => {
        scheduledDelays.push(ms);
        return setTimeout(fn, ms);
      }) as typeof setTimeout,
      clearTimeoutFn: clearTimeout,
    });

    expect(sweeper.started).toBe(true);

    // Flush initial reclaim promise.
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 7 }));
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "scoring_v2.evidence_export_reclaim",
        reclaimed: 1,
        batchSize: 7,
      }),
      expect.any(String),
    );
    expect(scheduledDelays[0]).toBe(5_000);

    // Next tick: no stale rows.
    await vi.advanceTimersByTimeAsync(5_000);
    await Promise.resolve();
    await Promise.resolve();

    expect(findMany.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "scoring_v2.evidence_export_reclaim",
        reclaimed: 0,
      }),
      expect.any(String),
    );

    sweeper.stop();
  });

  it("stop() clears the timer and prevents further reclaim ticks", async () => {
    vi.useFakeTimers();
    const findMany = vi.fn().mockResolvedValue([]);
    const updateMany = vi.fn();
    const logger = { info: vi.fn(), warn: vi.fn() };

    const sweeper = startEvidenceExportRecoverySweeper({
      prisma: { scoringV2EvidenceExport: { findMany, updateMany } } as never,
      logger: logger as never,
      intervalMs: 2_000,
      batchSize: 5,
    });

    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();
    const callsAfterStart = findMany.mock.calls.length;

    sweeper.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    await Promise.resolve();

    expect(findMany.mock.calls.length).toBe(callsAfterStart);
    expect(updateMany).not.toHaveBeenCalled();
  });
});
