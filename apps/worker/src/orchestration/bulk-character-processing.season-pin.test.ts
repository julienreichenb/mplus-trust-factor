import { describe, expect, it, vi } from "vitest";
import { enqueueBulkChildForItem } from "./bulk-character-processing.js";

describe("bulk RECALCULATE_ONLY season pinning", () => {
  it("child job uses pinnedSeasonId even when effective season would differ", async () => {
    const enqueueRecalculateScore = vi.fn(async () => ({
      jobId: "job-1",
      enqueued: true,
      reused: false,
    }));
    const requireEffective = vi.fn();
    const container = {
      prisma: {},
      repositories: {
        character: {
          findById: vi.fn(async () => ({
            id: "char-1",
            regionId: "reg-1",
          })),
        },
      },
    };
    const producers = {
      enqueueRecalculateScore,
      enqueueRefreshCharacter: vi.fn(),
      enqueueBulkCharacterProcessing: vi.fn(),
    };

    await enqueueBulkChildForItem(
      container as never,
      producers as never,
      {
        id: "item-1",
        characterId: "char-1",
        region: "EU",
        realmSlug: "archimonde",
        characterName: "Tester",
      },
      "RECALCULATE_ONLY",
      { key: "default", version: 6 },
      "season-a",
    );

    expect(enqueueRecalculateScore).toHaveBeenCalledWith(
      expect.objectContaining({
        characterId: "char-1",
        seasonId: "season-a",
      }),
    );
    expect(requireEffective).not.toHaveBeenCalled();
  });
});
