import { describe, expect, it, vi } from "vitest";
import { BulkCharacterProcessingService } from "./bulk-character-processing-service.js";

describe("BulkCharacterProcessingService Agent 08 hook", () => {
  it("enqueueRecalculateAllForModel keeps a stable RECALCULATE_ONLY all-characters contract", async () => {
    const create = vi.fn().mockResolvedValue({
      id: "op-1",
      mode: "RECALCULATE_ONLY",
      completionSemantics: "CHILD_DISPATCH_FINISHED",
      childOutcomesTracked: false,
    });
    const service = Object.create(BulkCharacterProcessingService.prototype) as BulkCharacterProcessingService;
    (service as unknown as { create: typeof create }).create = create;

    await service.enqueueRecalculateAllForModel("model-uuid", {
      createdByUserId: "user-1",
      batchSize: 40,
    });

    expect(create).toHaveBeenCalledWith(
      {
        mode: "RECALCULATE_ONLY",
        minMythicPlusScore: null,
        scoreModelId: "model-uuid",
        batchSize: 40,
        maxCharacters: null,
        maxWclCalls: null,
        dryRun: false,
        allowFullRefreshOnIncompatible: false,
        logicalKey: "model-activate:model-uuid",
      },
      { createdByUserId: "user-1" },
    );
  });
});
