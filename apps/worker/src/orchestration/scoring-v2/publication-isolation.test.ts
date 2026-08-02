import { describe, expect, it, vi } from "vitest";
import { runFinalizeEvidenceBatchV2 } from "./finalize.js";

/**
 * Publication isolation: finalize must never write CharacterPublishedScore.
 */
describe("scoring v2 finalize publication isolation", () => {
  it("never calls CharacterPublishedScore mutators", async () => {
    const characterPublishedScore = {
      create: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
    };

    const container = {
      env: {
        SCORING_V2_ENABLED: false,
        SCORING_V2_PUBLICATION_ENABLED: false,
      },
      prisma: { characterPublishedScore },
      repositories: {
        evidenceV2Batch: {
          getById: vi.fn(),
        },
      },
      logger: { info: vi.fn(), error: vi.fn() },
    };

    const result = await runFinalizeEvidenceBatchV2(container as never, {
      analysisBatchId: "batch-1",
      acquisitionPlanContentHash: "plan",
      refreshGeneration: 1,
    } as never);

    expect(result.outcome).toBe("flags_off");
    expect(characterPublishedScore.create).not.toHaveBeenCalled();
    expect(characterPublishedScore.update).not.toHaveBeenCalled();
    expect(characterPublishedScore.upsert).not.toHaveBeenCalled();
    expect(characterPublishedScore.delete).not.toHaveBeenCalled();
  });
});
