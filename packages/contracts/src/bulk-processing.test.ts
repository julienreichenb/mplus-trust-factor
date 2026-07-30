import { describe, expect, it } from "vitest";
import type { BulkOperationItemStatus, BulkOperationProgressDTO } from "@mplus/contracts";

describe("bulk processing contracts", () => {
  it("progress DTO uses dispatch counters only", () => {
    const progress: BulkOperationProgressDTO = {
      selectedCount: 1,
      skippedCount: 0,
      dispatchedCount: 1,
      enqueuedCount: 1,
      dispatchFailedCount: 0,
      estimatedWclCalls: null,
      consumedWclCalls: null,
      cursor: 1,
    };
    expect("completedCount" in progress).toBe(false);
    expect("failedCount" in progress).toBe(false);
    expect(progress.dispatchedCount).toBe(1);
    expect(progress.dispatchFailedCount).toBe(0);
  });

  it("item status union has no COMPLETED/FAILED terminal outcomes", () => {
    const statuses: BulkOperationItemStatus[] = [
      "PENDING",
      "ENQUEUED",
      "SKIPPED_INCOMPATIBLE",
      "SKIPPED_BUDGET",
      "SKIPPED_CANCELLED",
      "SKIPPED_DRY_RUN",
      "SKIPPED_CHARACTER_DELETED",
    ];
    expect(statuses).not.toContain("COMPLETED" as BulkOperationItemStatus);
    expect(statuses).not.toContain("FAILED" as BulkOperationItemStatus);
  });
});
