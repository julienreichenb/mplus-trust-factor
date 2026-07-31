import { describe, expect, it, vi } from "vitest";
import { BULK_OPERATION_ITEMS_DETAIL_LIMIT } from "@mplus/contracts";
import { BulkCharacterProcessingService } from "./bulk-character-processing-service.js";

describe("BulkCharacterProcessingService detail truncation", () => {
  it("exposes itemsTotal / itemsTruncated when the detail page is capped", async () => {
    const items = Array.from({ length: BULK_OPERATION_ITEMS_DETAIL_LIMIT }, (_, i) => ({
      id: `item-${i}`,
      bulkOperationId: "op-1",
      characterId: null,
      position: i,
      status: "ENQUEUED",
      region: "EU",
      realmSlug: "tarren-mill",
      characterName: `Char${i}`,
      mythicPlusScore: null,
      evidenceCompatible: true,
      skipReason: null,
      error: null,
      childJobId: null,
      childJobType: null,
      processedAt: null,
    }));
    const service = new BulkCharacterProcessingService({
      worker: {
        repositories: {
          bulkOperation: {
            findByIdWithItems: vi.fn().mockResolvedValue({
              id: "op-1",
              mode: "RECALCULATE_ONLY",
              status: "COMPLETED",
              logicalKey: "bulk:x",
              minMythicPlusScore: null,
              scoreModelId: null,
              batchSize: 25,
              maxCharacters: null,
              maxWclCalls: null,
              dryRun: false,
              allowFullRefreshOnIncompatible: false,
              selectionFingerprint: null,
              selectedCount: 250,
              skippedCount: 0,
              dispatchedCount: 200,
              enqueuedCount: 200,
              dispatchFailedCount: 0,
              estimatedWclCalls: null,
              consumedWclCalls: null,
              createdByUserId: null,
              cancelRequestedAt: null,
              pauseRequestedAt: null,
              error: null,
              startedAt: null,
              completedAt: null,
              createdAt: new Date(),
              updatedAt: new Date(),
              checkpoint: {},
              configSnapshot: { characterIds: null },
              items,
              itemsTotal: 250,
            }),
          },
        },
      },
    } as never);

    const detail = await service.get("op-1");
    expect(detail.items).toHaveLength(BULK_OPERATION_ITEMS_DETAIL_LIMIT);
    expect(detail.itemsTotal).toBe(250);
    expect(detail.itemsLimit).toBe(BULK_OPERATION_ITEMS_DETAIL_LIMIT);
    expect(detail.itemsTruncated).toBe(true);
  });
});
