import { describe, expect, it, vi } from "vitest";
import type { BulkOrchestratorJob } from "@mplus/contracts";
import { QUEUE_NAMES } from "@mplus/contracts";
import { runBulkCharacterProcessing } from "./bulk-character-processing.js";
import { emptyBulkCheckpoint } from "./bulk-checkpoint.js";

function makeOperation(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    mode: "RECALCULATE_ONLY",
    status: "PENDING",
    logicalKey: "bulk:RECALCULATE_ONLY:all:active",
    minMythicPlusScore: null,
    scoreModelId: null,
    batchSize: 10,
    maxCharacters: null,
    maxWclCalls: null,
    dryRun: true,
    allowFullRefreshOnIncompatible: false,
    checkpoint: emptyBulkCheckpoint(),
    selectedCount: 0,
    enqueuedCount: 0,
    dispatchedCount: 0,
    dispatchFailedCount: 0,
    skippedCount: 0,
    estimatedWclCalls: null,
    consumedWclCalls: null,
    cancelRequestedAt: null,
    pauseRequestedAt: null,
    ...overrides,
  };
}

describe("runBulkCharacterProcessing hardening", () => {
  it("dry-run completes selection without enqueueing child jobs", async () => {
    const operation = makeOperation();
    const saved = { ...operation, status: "DRY_RUN_COMPLETED", dryRun: true, selectedCount: 2 };
    const repo = {
      findById: vi.fn().mockResolvedValueOnce(operation).mockResolvedValue(saved),
      parseCheckpoint: vi.fn().mockReturnValue(emptyBulkCheckpoint()),
      markSelecting: vi.fn().mockResolvedValue({ ...operation, status: "SELECTING" }),
      listSelectableCharacters: vi.fn().mockResolvedValue([
        {
          characterId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          region: "EU",
          regionId: "region-1",
          realmSlug: "tarren-mill",
          name: "Alpha",
          mythicPlusScore: 3000,
          seasonId: "season-1",
          seasonSlug: "blizzard-season-13",
          hasSeasonObservations: true,
          observationSchemaVersions: ["observations-v2"],
          storedRefreshContract: null,
        },
      ]),
      saveSelection: vi.fn().mockResolvedValue(saved),
    };

    const producers = {
      enqueueRefreshCharacter: vi.fn(),
      enqueueRecalculateScore: vi.fn(),
      enqueueBulkCharacterProcessing: vi.fn(),
    };

    const container = {
      repositories: {
        bulkOperation: repo,
        score: {
          getActiveModel: vi.fn().mockResolvedValue({ id: "m", key: "default", version: 6 }),
        },
        character: {},
      },
      env: { ACTIVE_SCORE_MODEL_KEY: "default", PROVIDER_MODE: "fixture" },
      prisma: {},
      logger: { warn: vi.fn() },
    } as never;

    const result = await runBulkCharacterProcessing(
      container,
      { bulkOperationId: operation.id, requestedAt: new Date().toISOString() },
      producers,
    );
    expect(result.dryRun).toBe(true);
    expect(result.status).toBe("DRY_RUN_COMPLETED");
    expect(result.completionSemantics).toBe("CHILD_DISPATCH_FINISHED");
    expect(producers.enqueueRefreshCharacter).not.toHaveBeenCalled();
    expect(producers.enqueueRecalculateScore).not.toHaveBeenCalled();
  });

  it("COMPLETED means dispatch finished and does not imply child success", async () => {
    const checkpoint = { ...emptyBulkCheckpoint(), selectionComplete: true };
    const operation = makeOperation({
      dryRun: false,
      status: "RUNNING",
      mode: "FULL_REFRESH",
      checkpoint,
      batchSize: 1,
    });
    const item = {
      id: "item-1",
      characterId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      position: 0,
      status: "PENDING",
      region: "EU",
      realmSlug: "tarren-mill",
      characterName: "Alpha",
      skipReason: null,
    };
    const repo = {
      findById: vi.fn().mockResolvedValue(operation),
      parseCheckpoint: vi.fn().mockReturnValue(checkpoint),
      listPendingItems: vi.fn().mockResolvedValueOnce([item]).mockResolvedValueOnce([]),
      updateItemStatus: vi.fn().mockResolvedValue({ ...item, status: "ENQUEUED" }),
      saveCheckpoint: vi.fn().mockResolvedValue(operation),
      markTerminal: vi.fn().mockResolvedValue({ ...operation, status: "COMPLETED" }),
    };
    const producers = {
      enqueueRefreshCharacter: vi.fn().mockResolvedValue({
        jobId: "job-1",
        dedupeKey: "d",
        reused: false,
        enqueued: true,
      }),
      enqueueRecalculateScore: vi.fn(),
      enqueueBulkCharacterProcessing: vi.fn(),
    };
    const container = {
      repositories: {
        bulkOperation: repo,
        score: { getActiveModel: vi.fn().mockResolvedValue({ id: "m", key: "default", version: 6 }) },
        character: {},
      },
      env: { ACTIVE_SCORE_MODEL_KEY: "default", PROVIDER_MODE: "fixture" },
      prisma: {},
      logger: { warn: vi.fn() },
    } as never;

    const result = await runBulkCharacterProcessing(
      container,
      { bulkOperationId: operation.id, requestedAt: new Date().toISOString() },
      producers,
    );
    expect(result.status).toBe("COMPLETED");
    expect(result.completionSemantics).toBe("CHILD_DISPATCH_FINISHED");
    expect(producers.enqueueRefreshCharacter).toHaveBeenCalledWith(
      expect.objectContaining({ triggerSource: "BULK_REFRESH" }),
    );
    expect(producers.enqueueRecalculateScore).not.toHaveBeenCalled();
    expect(repo.updateItemStatus).toHaveBeenCalledWith(
      "item-1",
      expect.objectContaining({ status: "ENQUEUED", childJobType: QUEUE_NAMES.refreshCharacter }),
    );
  });

  it("leaves failed dispatch as PENDING so resume can retry without treating it as success", async () => {
    const checkpoint = { ...emptyBulkCheckpoint(), selectionComplete: true };
    const operation = makeOperation({
      dryRun: false,
      status: "RUNNING",
      mode: "FULL_REFRESH",
      checkpoint,
      batchSize: 2,
    });
    const items = [
      {
        id: "item-1",
        characterId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        position: 0,
        status: "PENDING",
        region: "EU",
        realmSlug: "tarren-mill",
        characterName: "Alpha",
        skipReason: null,
      },
      {
        id: "item-2",
        characterId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        position: 1,
        status: "PENDING",
        region: "EU",
        realmSlug: "tarren-mill",
        characterName: "Beta",
        skipReason: null,
      },
    ];
    const repo = {
      findById: vi.fn().mockResolvedValue(operation),
      parseCheckpoint: vi.fn().mockReturnValue(checkpoint),
      // After first tick, item-1 still PENDING (failed), item-2 ENQUEUED → still more pending
      listPendingItems: vi
        .fn()
        .mockResolvedValueOnce(items)
        .mockResolvedValueOnce([{ id: "item-1", status: "PENDING", position: 0 }]),
      updateItemStatus: vi.fn().mockResolvedValue({}),
      saveCheckpoint: vi.fn().mockResolvedValue(operation),
      markTerminal: vi.fn(),
    };
    const producers = {
      enqueueRefreshCharacter: vi
        .fn()
        .mockRejectedValueOnce(new Error("boom"))
        .mockResolvedValueOnce({ jobId: "job-2", dedupeKey: "d", reused: false, enqueued: true }),
      enqueueRecalculateScore: vi.fn(),
      enqueueBulkCharacterProcessing: vi.fn().mockResolvedValue({
        jobId: "bulk-2",
        dedupeKey: "b",
        reused: false,
        enqueued: true,
      }),
    };
    const container = {
      repositories: {
        bulkOperation: repo,
        score: { getActiveModel: vi.fn().mockResolvedValue({ id: "m", key: "default", version: 6 }) },
        character: {},
      },
      env: { ACTIVE_SCORE_MODEL_KEY: "default", PROVIDER_MODE: "fixture" },
      prisma: {},
      logger: { warn: vi.fn() },
    } as never;

    const result = await runBulkCharacterProcessing(
      container,
      { bulkOperationId: operation.id, requestedAt: new Date().toISOString() },
      producers,
    );
    expect(result.status).toBe("RUNNING");
    expect(result.requeued).toBe(true);
    expect(repo.markTerminal).not.toHaveBeenCalled();
    expect(repo.updateItemStatus).toHaveBeenCalledWith(
      "item-1",
      expect.objectContaining({ status: "PENDING" }),
    );
    expect(repo.updateItemStatus).toHaveBeenCalledWith(
      "item-2",
      expect.objectContaining({ status: "ENQUEUED" }),
    );
    // Failed item was not counted as dispatched success
    expect(repo.saveCheckpoint).toHaveBeenCalledWith(
      operation.id,
      expect.objectContaining({ dispatchedCount: 1 }),
      expect.any(Object),
    );
  });

  it("does not hot-loop when an entire batch fails dispatch", async () => {
    const checkpoint = { ...emptyBulkCheckpoint(), selectionComplete: true };
    const operation = makeOperation({
      dryRun: false,
      status: "RUNNING",
      mode: "FULL_REFRESH",
      checkpoint,
      batchSize: 1,
    });
    const item = {
      id: "item-1",
      characterId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      position: 0,
      status: "PENDING",
      region: "EU",
      realmSlug: "tarren-mill",
      characterName: "Alpha",
      skipReason: null,
    };
    const repo = {
      findById: vi.fn().mockResolvedValue(operation),
      parseCheckpoint: vi.fn().mockReturnValue(checkpoint),
      listPendingItems: vi.fn().mockResolvedValue([item]),
      updateItemStatus: vi.fn().mockResolvedValue({}),
      saveCheckpoint: vi.fn().mockResolvedValue(operation),
      markTerminal: vi.fn(),
    };
    const producers = {
      enqueueRefreshCharacter: vi.fn().mockRejectedValue(new Error("boom")),
      enqueueRecalculateScore: vi.fn(),
      enqueueBulkCharacterProcessing: vi.fn(),
    };
    const container = {
      repositories: {
        bulkOperation: repo,
        score: { getActiveModel: vi.fn().mockResolvedValue({ id: "m", key: "default", version: 6 }) },
        character: {},
      },
      env: { ACTIVE_SCORE_MODEL_KEY: "default", PROVIDER_MODE: "fixture" },
      prisma: {},
      logger: { warn: vi.fn() },
    } as never;

    const result = await runBulkCharacterProcessing(
      container,
      { bulkOperationId: operation.id, requestedAt: new Date().toISOString() },
      producers,
    );
    expect(result.status).toBe("RUNNING");
    expect(result.requeued).toBe(false);
    expect(producers.enqueueBulkCharacterProcessing).not.toHaveBeenCalled();
    expect(repo.markTerminal).not.toHaveBeenCalledWith(operation.id, "COMPLETED");
  });

  it("does not re-dispatch already ENQUEUED items on resume (idempotent)", async () => {
    const checkpoint = {
      ...emptyBulkCheckpoint(),
      selectionComplete: true,
      dispatchedCount: 1,
      cursor: 1,
    };
    const operation = makeOperation({
      dryRun: false,
      status: "RUNNING",
      mode: "FULL_REFRESH",
      checkpoint,
      batchSize: 10,
    });
    // Only remaining PENDING item is returned — ENQUEUED ones are excluded by query
    const remaining = {
      id: "item-2",
      characterId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      position: 1,
      status: "PENDING",
      region: "EU",
      realmSlug: "tarren-mill",
      characterName: "Beta",
      skipReason: null,
    };
    const repo = {
      findById: vi.fn().mockResolvedValue(operation),
      parseCheckpoint: vi.fn().mockReturnValue(checkpoint),
      listPendingItems: vi.fn().mockResolvedValueOnce([remaining]).mockResolvedValueOnce([]),
      updateItemStatus: vi.fn().mockResolvedValue({ ...remaining, status: "ENQUEUED" }),
      saveCheckpoint: vi.fn().mockResolvedValue(operation),
      markTerminal: vi.fn().mockResolvedValue({ ...operation, status: "COMPLETED" }),
    };
    const producers = {
      enqueueRefreshCharacter: vi.fn().mockResolvedValue({
        jobId: "job-2",
        dedupeKey: "d2",
        reused: false,
        enqueued: true,
      }),
      enqueueRecalculateScore: vi.fn(),
      enqueueBulkCharacterProcessing: vi.fn(),
    };
    const container = {
      repositories: {
        bulkOperation: repo,
        score: { getActiveModel: vi.fn().mockResolvedValue({ id: "m", key: "default", version: 6 }) },
        character: {},
      },
      env: { ACTIVE_SCORE_MODEL_KEY: "default", PROVIDER_MODE: "fixture" },
      prisma: {},
      logger: { warn: vi.fn() },
    } as never;

    await runBulkCharacterProcessing(
      container,
      { bulkOperationId: operation.id, requestedAt: new Date().toISOString() },
      producers,
    );
    expect(producers.enqueueRefreshCharacter).toHaveBeenCalledTimes(1);
    expect(producers.enqueueRefreshCharacter).toHaveBeenCalledWith(
      expect.objectContaining({ characterId: remaining.characterId }),
    );
  });

  it("cancel becomes CANCELLED, not COMPLETED", async () => {
    const checkpoint = { ...emptyBulkCheckpoint(), selectionComplete: true };
    const operation = makeOperation({
      dryRun: false,
      status: "RUNNING",
      checkpoint,
      cancelRequestedAt: new Date(),
    });
    const repo = {
      findById: vi.fn().mockResolvedValue(operation),
      parseCheckpoint: vi.fn().mockReturnValue(checkpoint),
      listPendingItems: vi.fn().mockResolvedValue([
        {
          id: "item-1",
          characterId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          position: 0,
          status: "PENDING",
          region: "EU",
          realmSlug: "tarren-mill",
          characterName: "Alpha",
          skipReason: null,
        },
      ]),
      updateItemStatus: vi.fn().mockResolvedValue({}),
      saveCheckpoint: vi.fn().mockResolvedValue(operation),
      markTerminal: vi.fn().mockResolvedValue({ ...operation, status: "CANCELLED" }),
    };
    const producers = {
      enqueueRefreshCharacter: vi.fn(),
      enqueueRecalculateScore: vi.fn(),
      enqueueBulkCharacterProcessing: vi.fn(),
    };
    const container = {
      repositories: {
        bulkOperation: repo,
        score: { getActiveModel: vi.fn().mockResolvedValue({ id: "m", key: "default", version: 6 }) },
        character: {},
      },
      env: { ACTIVE_SCORE_MODEL_KEY: "default", PROVIDER_MODE: "fixture" },
      prisma: {},
      logger: { warn: vi.fn() },
    } as never;

    const result = await runBulkCharacterProcessing(
      container,
      { bulkOperationId: operation.id, requestedAt: new Date().toISOString() } satisfies BulkOrchestratorJob,
      producers,
    );
    expect(result.status).toBe("CANCELLED");
    expect(repo.markTerminal).toHaveBeenCalledWith(operation.id, "CANCELLED");
    expect(producers.enqueueRefreshCharacter).not.toHaveBeenCalled();
  });

  it("pause becomes PAUSED, not COMPLETED", async () => {
    const checkpoint = { ...emptyBulkCheckpoint(), selectionComplete: true };
    const operation = makeOperation({
      dryRun: false,
      status: "RUNNING",
      checkpoint,
      pauseRequestedAt: new Date(),
    });
    const repo = {
      findById: vi.fn().mockResolvedValue(operation),
      parseCheckpoint: vi.fn().mockReturnValue(checkpoint),
      listPendingItems: vi.fn(),
      saveCheckpoint: vi.fn().mockResolvedValue({ ...operation, status: "PAUSED" }),
      markTerminal: vi.fn(),
    };
    const producers = {
      enqueueRefreshCharacter: vi.fn(),
      enqueueRecalculateScore: vi.fn(),
      enqueueBulkCharacterProcessing: vi.fn(),
    };
    const container = {
      repositories: {
        bulkOperation: repo,
        score: { getActiveModel: vi.fn().mockResolvedValue({ id: "m", key: "default", version: 6 }) },
        character: {},
      },
      env: { ACTIVE_SCORE_MODEL_KEY: "default", PROVIDER_MODE: "fixture" },
      prisma: {},
      logger: { warn: vi.fn() },
    } as never;

    const result = await runBulkCharacterProcessing(
      container,
      { bulkOperationId: operation.id, requestedAt: new Date().toISOString() },
      producers,
    );
    expect(result.status).toBe("PAUSED");
    expect(repo.markTerminal).not.toHaveBeenCalled();
    expect(repo.saveCheckpoint).toHaveBeenCalledWith(
      operation.id,
      expect.any(Object),
      expect.objectContaining({ status: "PAUSED" }),
    );
  });

  it("skips items whose characterId was cleared after character deletion", async () => {
    const checkpoint = { ...emptyBulkCheckpoint(), selectionComplete: true };
    const operation = makeOperation({
      dryRun: false,
      status: "RUNNING",
      mode: "FULL_REFRESH",
      checkpoint,
      batchSize: 1,
    });
    const item = {
      id: "item-1",
      characterId: null,
      position: 0,
      status: "PENDING",
      region: "EU",
      realmSlug: "tarren-mill",
      characterName: "Gone",
      skipReason: null,
    };
    const repo = {
      findById: vi.fn().mockResolvedValue(operation),
      parseCheckpoint: vi.fn().mockReturnValue(checkpoint),
      listPendingItems: vi.fn().mockResolvedValueOnce([item]).mockResolvedValueOnce([]),
      updateItemStatus: vi.fn().mockResolvedValue({ ...item, status: "SKIPPED_CHARACTER_DELETED" }),
      saveCheckpoint: vi.fn().mockResolvedValue(operation),
      markTerminal: vi.fn().mockResolvedValue({ ...operation, status: "COMPLETED" }),
    };
    const producers = {
      enqueueRefreshCharacter: vi.fn(),
      enqueueRecalculateScore: vi.fn(),
      enqueueBulkCharacterProcessing: vi.fn(),
    };
    const container = {
      repositories: {
        bulkOperation: repo,
        score: { getActiveModel: vi.fn().mockResolvedValue({ id: "m", key: "default", version: 6 }) },
        character: {},
      },
      env: { ACTIVE_SCORE_MODEL_KEY: "default", PROVIDER_MODE: "fixture" },
      prisma: {},
      logger: { warn: vi.fn() },
    } as never;

    const result = await runBulkCharacterProcessing(
      container,
      { bulkOperationId: operation.id, requestedAt: new Date().toISOString() },
      producers,
    );
    expect(result.status).toBe("COMPLETED");
    expect(producers.enqueueRefreshCharacter).not.toHaveBeenCalled();
    expect(repo.updateItemStatus).toHaveBeenCalledWith(
      "item-1",
      expect.objectContaining({ status: "SKIPPED_CHARACTER_DELETED", skipReason: "CHARACTER_DELETED" }),
    );
  });
});

