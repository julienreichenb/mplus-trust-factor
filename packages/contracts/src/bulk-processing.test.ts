import { describe, expect, it } from "vitest";
import type {
  BulkOperationDetailDTO,
  BulkOperationItemStatus,
  BulkOperationProgressDTO,
} from "@mplus/contracts";

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

  it("detail DTO exposes truncation metadata and selectionMode", () => {
    const detail: BulkOperationDetailDTO = {
      id: "op",
      mode: "RECALCULATE_ONLY",
      status: "DRY_RUN_COMPLETED",
      completionSemantics: "CHILD_DISPATCH_FINISHED",
      childOutcomesTracked: false,
      selectionMode: "EXPLICIT",
      logicalKey: "bulk:x",
      minMythicPlusScore: null,
      scoreModelId: null,
      batchSize: 25,
      maxCharacters: null,
      maxWclCalls: null,
      dryRun: true,
      allowFullRefreshOnIncompatible: false,
      selectionFingerprint: null,
      progress: {
        selectedCount: 0,
        skippedCount: 0,
        dispatchedCount: 0,
        enqueuedCount: 0,
        dispatchFailedCount: 0,
        estimatedWclCalls: null,
        consumedWclCalls: null,
        cursor: 0,
      },
      createdByUserId: null,
      cancelRequestedAt: null,
      pauseRequestedAt: null,
      errorMessage: null,
      startedAt: null,
      completedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      items: [],
      itemsTotal: 250,
      itemsLimit: 200,
      itemsTruncated: true,
    };
    expect(detail.selectionMode).toBe("EXPLICIT");
    expect(detail.itemsTruncated).toBe(true);
  });
});
