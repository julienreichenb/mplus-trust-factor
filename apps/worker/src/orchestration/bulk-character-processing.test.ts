import { describe, expect, it } from "vitest";
import {
  emptyBulkCheckpoint,
  parseBulkCheckpoint,
  shouldStopForWclBudget,
} from "./bulk-checkpoint.js";

describe("bulk checkpoint", () => {
  it("round-trips a valid checkpoint and falls back on invalid JSON", () => {
    const checkpoint = emptyBulkCheckpoint();
    checkpoint.cursor = 3;
    checkpoint.enqueuedCount = 2;
    checkpoint.dispatchedCount = 2;
    checkpoint.dispatchFailedCount = 0;
    checkpoint.selectionComplete = true;
    const parsed = parseBulkCheckpoint(checkpoint);
    expect(parsed.cursor).toBe(3);
    expect(parsed.enqueuedCount).toBe(2);
    expect(parsed.dispatchedCount).toBe(2);
    expect(parsed.dispatchFailedCount).toBe(0);
    expect(parsed.selectionComplete).toBe(true);
    expect(parseBulkCheckpoint({ cursor: "nope" }).cursor).toBe(0);
    expect(parseBulkCheckpoint({ ...checkpoint, completedCount: 1, dispatchedCount: undefined }).cursor).toBe(0);
  });

  it("stops full refresh when the next batch would exceed WCL budget", () => {
    expect(
      shouldStopForWclBudget({
        mode: "FULL_REFRESH",
        maxWclCalls: 20,
        consumedWclCalls: 16,
        nextBatchEstimatedCalls: 8,
      }),
    ).toBe(true);
    expect(
      shouldStopForWclBudget({
        mode: "RECALCULATE_ONLY",
        maxWclCalls: 1,
        consumedWclCalls: 0,
        nextBatchEstimatedCalls: 8,
      }),
    ).toBe(false);
  });
});
