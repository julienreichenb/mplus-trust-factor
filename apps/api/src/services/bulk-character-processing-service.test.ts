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
        characterIds: null,
      },
      { createdByUserId: "user-1" },
    );
  });

  it("enqueueRecalculateForSeasonScores pins season and never cohort-falls-back", async () => {
    const create = vi.fn().mockResolvedValue({
      id: "op-1",
      mode: "RECALCULATE_ONLY",
    });
    const service = Object.create(BulkCharacterProcessingService.prototype) as BulkCharacterProcessingService;
    (service as unknown as { create: typeof create }).create = create;
    const ids = Array.from({ length: 2 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);

    await service.enqueueRecalculateForSeasonScores({
      seasonId: "11111111-1111-4111-8111-111111111111",
      scoreModelId: null,
      characterIds: ids,
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "RECALCULATE_ONLY",
        characterIds: ids,
        pinnedSeasonId: "11111111-1111-4111-8111-111111111111",
        logicalKey: "season-context:11111111-1111-4111-8111-111111111111:chunk:0",
      }),
      expect.anything(),
    );
    expect(create.mock.calls[0]?.[0].characterIds).not.toBeNull();
  });
});
