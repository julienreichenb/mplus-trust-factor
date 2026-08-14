/**
 * Resumable bulk character processing orchestrator.
 * Isolated from Utility fallback / refresh-pipeline internals — fans out via existing queues only.
 *
 * Status COMPLETED means child-job *dispatch* finished for every selected item
 * (or items were skipped). It does not mean child refresh/recalculate succeeded.
 */

import {
  QUEUE_NAMES,
  type BulkOrchestratorJob,
  type BulkMode,
} from "@mplus/contracts";
import type { WorkerContainer } from "../container.js";
import type { EnqueueResult, QueueProducers } from "../queues.js";
import {
  ESTIMATED_WCL_CALLS_PER_FULL_REFRESH,
  selectBulkCharacters,
  type BulkSelectableCharacter,
} from "./bulk-character-selection.js";
import {
  emptyBulkCheckpoint,
  shouldStopForWclBudget,
  type BulkOrchestratorCheckpoint,
} from "./bulk-checkpoint.js";
import { evaluateRecalculateCompatibility } from "./bulk-recalculate-compatibility.js";
import { resolveActiveRefreshContract } from "./build-refresh-contract.js";
import { requireEffectiveScoringSeasonRow } from "./active-mplus-season/effective-season-peek.js";

export type BulkChildProducers = Pick<
  QueueProducers,
  "enqueueRefreshCharacter" | "enqueueRecalculateScore" | "enqueueBulkCharacterProcessing"
>;

export interface BulkOrchestratorTickResult {
  bulkOperationId: string;
  status: string;
  checkpoint: BulkOrchestratorCheckpoint;
  batchEnqueued: number;
  requeued: boolean;
  dryRun: boolean;
  /** Explicit: COMPLETED is dispatch-finished, not child success. */
  completionSemantics: "CHILD_DISPATCH_FINISHED";
}

async function resolveScoreModel(
  container: WorkerContainer,
  scoreModelId: string | null,
): Promise<{ key: string; version: number; id: string }> {
  if (scoreModelId) {
    const model = await container.repositories.score.getModelById(scoreModelId);
    if (!model) {
      throw new Error(`Score model ${scoreModelId} not found`);
    }
    return { key: model.key, version: model.version, id: model.id };
  }
  const active = await container.repositories.score.getActiveModel();
  if (!active) {
    throw new Error(`No active score model found in the database`);
  }
  return { key: active.key, version: active.version, id: active.id };
}

class CharacterDeletedError extends Error {
  constructor(characterId: string | null) {
    super(characterId ? `Character ${characterId} was deleted` : "Character was deleted");
    this.name = "CharacterDeletedError";
  }
}

function readCharacterIdsFromSnapshot(snapshot: unknown): string[] | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return null;
  }
  const record = snapshot as Record<string, unknown>;
  // Legacy cohort ops have no characterIds key — keep cohort selection.
  if (!Object.prototype.hasOwnProperty.call(record, "characterIds")) {
    return null;
  }
  const raw = record.characterIds;
  if (raw === null || raw === undefined) {
    return null;
  }
  if (!Array.isArray(raw)) {
    throw new Error(
      "Bulk operation configSnapshot.characterIds is corrupt; refusing cohort fallback for explicit selection",
    );
  }
  if (raw.length === 0) {
    throw new Error(
      "Bulk operation configSnapshot.characterIds is empty; refusing cohort fallback for explicit selection",
    );
  }
  const ids: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      throw new Error(
        "Bulk operation configSnapshot.characterIds contains invalid entries; refusing cohort fallback",
      );
    }
    ids.push(entry);
  }
  return ids;
}

/** Exported for unit tests — durable explicit ID resume from configSnapshot. */
export { readCharacterIdsFromSnapshot };

async function enqueueChildForItem(
  container: WorkerContainer,
  producers: BulkChildProducers,
  item: {
    id: string;
    characterId: string | null;
    region: string;
    realmSlug: string;
    characterName: string;
  },
  mode: BulkMode,
  scoreModel: { key: string; version: number },
): Promise<EnqueueResult & { childJobType: string }> {
  if (!item.characterId) {
    throw new CharacterDeletedError(null);
  }
  const characterId = item.characterId;

  if (mode === "FULL_REFRESH") {
    const result = await producers.enqueueRefreshCharacter({
      characterId,
      region: item.region,
      realmSlug: item.realmSlug,
      name: item.characterName,
      priority: "low",
      forceRefresh: false,
      triggerSource: "BULK_REFRESH",
    });
    return { ...result, childJobType: QUEUE_NAMES.refreshCharacter };
  }

  const character = await container.repositories.character.findById(characterId);
  if (!character) {
    throw new CharacterDeletedError(characterId);
  }
  const season = await requireEffectiveScoringSeasonRow(container.prisma, {
    regionId: character.regionId,
  });
  const result = await producers.enqueueRecalculateScore({
    characterId,
    seasonId: season.id,
    scoreModelKey: scoreModel.key,
    scoreModelVersion: scoreModel.version,
  });
  return { ...result, childJobType: QUEUE_NAMES.recalculateScore };
}

function toSelectableCharacters(
  container: WorkerContainer,
  scoreModel: { key: string; version: number },
  rows: Awaited<ReturnType<WorkerContainer["repositories"]["bulkOperation"]["listSelectableCharacters"]>>,
  mode: BulkMode,
): BulkSelectableCharacter[] {
  return rows.map((row) => {
    if (mode !== "RECALCULATE_ONLY") {
      return {
        characterId: row.characterId,
        region: row.region,
        realmSlug: row.realmSlug,
        name: row.name,
        mythicPlusScore: row.mythicPlusScore,
        hasCompatibleEvidence: true,
        incompatibilityReason: null,
      };
    }

    if (!row.seasonSlug || row.wclZoneId == null) {
      return {
        characterId: row.characterId,
        region: row.region,
        realmSlug: row.realmSlug,
        name: row.name,
        mythicPlusScore: row.mythicPlusScore,
        hasCompatibleEvidence: false,
        incompatibilityReason:
          row.seasonSlug == null ? "MISSING_CURRENT_SEASON" : "MISSING_SEASON_CATALOG_ZONE",
      };
    }

    const { contract } = resolveActiveRefreshContract({
      scoringModelKey: scoreModel.key,
      scoringModelVersion: scoreModel.version,
      activeSeasonId: row.seasonSlug,
      providerMode: container.env.PROVIDER_MODE,
      zoneId: row.wclZoneId,
    });
    const verdict = evaluateRecalculateCompatibility({
      hasSeasonObservations: row.hasSeasonObservations,
      storedRefreshContract: row.storedRefreshContract,
      currentRefreshContract: contract,
      observationSchemaVersions: row.observationSchemaVersions,
    });
    return {
      characterId: row.characterId,
      region: row.region,
      realmSlug: row.realmSlug,
      name: row.name,
      mythicPlusScore: row.mythicPlusScore,
      hasCompatibleEvidence: verdict.compatible,
      incompatibilityReason: verdict.reason,
    };
  });
}

/**
 * One orchestrator tick: select snapshot if needed, then fan out the next batch.
 * Idempotent on item status (ENQUEUED never re-dispatched) and child job dedupe keys.
 * Failed dispatch leaves the item PENDING so resume can retry.
 */
export async function runBulkCharacterProcessing(
  container: WorkerContainer,
  job: BulkOrchestratorJob,
  producers: BulkChildProducers,
): Promise<BulkOrchestratorTickResult> {
  const repo = container.repositories.bulkOperation;
  const operation = await repo.findById(job.bulkOperationId);
  if (!operation) {
    throw new Error(`Bulk operation ${job.bulkOperationId} not found`);
  }

  const baseResult = {
    bulkOperationId: operation.id,
    completionSemantics: "CHILD_DISPATCH_FINISHED" as const,
  };

  if (
    operation.status === "COMPLETED" ||
    operation.status === "CANCELLED" ||
    operation.status === "FAILED" ||
    operation.status === "DRY_RUN_COMPLETED"
  ) {
    return {
      ...baseResult,
      status: operation.status,
      checkpoint: repo.parseCheckpoint(operation),
      batchEnqueued: 0,
      requeued: false,
      dryRun: operation.dryRun,
    };
  }

  if (operation.status === "PAUSED" && !operation.pauseRequestedAt) {
    return {
      ...baseResult,
      status: operation.status,
      checkpoint: repo.parseCheckpoint(operation),
      batchEnqueued: 0,
      requeued: false,
      dryRun: operation.dryRun,
    };
  }

  let checkpoint = repo.parseCheckpoint(operation);
  const scoreModel = await resolveScoreModel(container, operation.scoreModelId);

  if (!checkpoint.selectionComplete) {
    await repo.markSelecting(operation.id);
    const characterIds = readCharacterIdsFromSnapshot(operation.configSnapshot);
    const rows = await repo.listSelectableCharacters(characterIds);
    const characters = toSelectableCharacters(container, scoreModel, rows, operation.mode);
    const selection = selectBulkCharacters({
      mode: operation.mode,
      minMythicPlusScore: operation.minMythicPlusScore,
      maxCharacters: operation.maxCharacters,
      allowFullRefreshOnIncompatible: operation.allowFullRefreshOnIncompatible,
      characters,
      characterIds,
    });
    checkpoint = {
      ...emptyBulkCheckpoint(),
      selectionComplete: true,
      skippedCount: selection.skippedIncompatibleCount + (operation.dryRun ? selection.items.length : 0),
    };
    const saved = await repo.saveSelection(operation.id, {
      selectionFingerprint: selection.selectionFingerprint,
      estimatedWclCalls: selection.estimatedWclCalls,
      items: selection.items,
      dryRun: operation.dryRun,
      checkpoint,
    });
    if (saved.dryRun || saved.status === "DRY_RUN_COMPLETED") {
      return {
        ...baseResult,
        bulkOperationId: saved.id,
        status: saved.status,
        checkpoint,
        batchEnqueued: 0,
        requeued: false,
        dryRun: true,
      };
    }
  }

  const fresh = await repo.findById(operation.id);
  if (!fresh) {
    throw new Error(`Bulk operation ${operation.id} disappeared`);
  }

  if (fresh.cancelRequestedAt) {
    // Always load remaining PENDING (cursor is not a skip fence).
    const pending = await repo.listPendingItems(fresh.id, 0, 10_000);
    for (const item of pending) {
      await repo.updateItemStatus(item.id, {
        status: "SKIPPED_CANCELLED",
        skipReason: "OPERATION_CANCELLED",
      });
      checkpoint.skippedCount += 1;
      checkpoint.processedCount += 1;
    }
    await repo.saveCheckpoint(fresh.id, checkpoint, {
      enqueuedCount: checkpoint.enqueuedCount,
      dispatchedCount: checkpoint.dispatchedCount,
      dispatchFailedCount: checkpoint.dispatchFailedCount,
      skippedCount: checkpoint.skippedCount,
      consumedWclCalls: checkpoint.consumedWclCalls,
    });
    const cancelled = await repo.markTerminal(fresh.id, "CANCELLED");
    return {
      ...baseResult,
      bulkOperationId: cancelled.id,
      status: cancelled.status,
      checkpoint,
      batchEnqueued: 0,
      requeued: false,
      dryRun: false,
    };
  }

  if (fresh.pauseRequestedAt) {
    await repo.saveCheckpoint(fresh.id, checkpoint, {
      enqueuedCount: checkpoint.enqueuedCount,
      dispatchedCount: checkpoint.dispatchedCount,
      dispatchFailedCount: checkpoint.dispatchFailedCount,
      skippedCount: checkpoint.skippedCount,
      consumedWclCalls: checkpoint.consumedWclCalls,
      status: "PAUSED",
    });
    return {
      ...baseResult,
      bulkOperationId: fresh.id,
      status: "PAUSED",
      checkpoint,
      batchEnqueued: 0,
      requeued: false,
      dryRun: false,
    };
  }

  const batchSize = Math.max(1, fresh.batchSize);
  // Cursor is progress-only — always take the next PENDING items so failed dispatch stays retryable.
  const pending = await repo.listPendingItems(fresh.id, 0, batchSize);

  if (pending.length === 0) {
    await repo.saveCheckpoint(fresh.id, checkpoint, {
      enqueuedCount: checkpoint.enqueuedCount,
      dispatchedCount: checkpoint.dispatchedCount,
      dispatchFailedCount: checkpoint.dispatchFailedCount,
      skippedCount: checkpoint.skippedCount,
      consumedWclCalls: checkpoint.consumedWclCalls,
    });
    const completed = await repo.markTerminal(fresh.id, "COMPLETED");
    return {
      ...baseResult,
      bulkOperationId: completed.id,
      status: completed.status,
      checkpoint,
      batchEnqueued: 0,
      requeued: false,
      dryRun: false,
    };
  }

  const estimatedCallsForBatch = pending.reduce((sum, item) => {
    const effectiveMode: BulkMode =
      (item.skipReason ?? "").startsWith("INCOMPATIBLE_EVIDENCE_CONVERTED")
        ? "FULL_REFRESH"
        : fresh.mode;
    return sum + (effectiveMode === "FULL_REFRESH" ? ESTIMATED_WCL_CALLS_PER_FULL_REFRESH : 0);
  }, 0);

  if (
    shouldStopForWclBudget({
      mode: estimatedCallsForBatch > 0 ? "FULL_REFRESH" : "RECALCULATE_ONLY",
      maxWclCalls: fresh.maxWclCalls,
      consumedWclCalls: checkpoint.consumedWclCalls,
      nextBatchEstimatedCalls: estimatedCallsForBatch,
    })
  ) {
    const allPending = await repo.listPendingItems(fresh.id, 0, 10_000);
    for (const item of allPending) {
      await repo.updateItemStatus(item.id, {
        status: "SKIPPED_BUDGET",
        skipReason: "WCL_BUDGET_EXHAUSTED",
      });
      checkpoint.skippedCount += 1;
      checkpoint.processedCount += 1;
      checkpoint.cursor = Math.max(checkpoint.cursor, item.position + 1);
      checkpoint.lastCharacterId = item.characterId;
    }
    await repo.saveCheckpoint(fresh.id, checkpoint, {
      enqueuedCount: checkpoint.enqueuedCount,
      dispatchedCount: checkpoint.dispatchedCount,
      dispatchFailedCount: checkpoint.dispatchFailedCount,
      skippedCount: checkpoint.skippedCount,
      consumedWclCalls: checkpoint.consumedWclCalls,
    });
    const completed = await repo.markTerminal(fresh.id, "COMPLETED");
    return {
      ...baseResult,
      bulkOperationId: completed.id,
      status: completed.status,
      checkpoint,
      batchEnqueued: 0,
      requeued: false,
      dryRun: false,
    };
  }

  let batchEnqueued = 0;
  for (const item of pending) {
    if (!item.characterId) {
      await repo.updateItemStatus(item.id, {
        status: "SKIPPED_CHARACTER_DELETED",
        skipReason: "CHARACTER_DELETED",
      });
      checkpoint.skippedCount += 1;
      checkpoint.processedCount += 1;
      checkpoint.cursor = Math.max(checkpoint.cursor, item.position + 1);
      continue;
    }

    const effectiveMode: BulkMode =
      (item.skipReason ?? "").startsWith("INCOMPATIBLE_EVIDENCE_CONVERTED")
        ? "FULL_REFRESH"
        : fresh.mode;

    try {
      const child = await enqueueChildForItem(container, producers, item, effectiveMode, scoreModel);
      await repo.updateItemStatus(item.id, {
        status: "ENQUEUED",
        childJobId: child.jobId,
        childJobType: child.childJobType,
        skipReason: item.skipReason,
      });
      // Every successful enqueue acceptance including active-job reuse.
      checkpoint.dispatchedCount += 1;
      if (!(child.reused && child.enqueued === false)) {
        checkpoint.enqueuedCount += 1;
        batchEnqueued += 1;
      }
      if (effectiveMode === "FULL_REFRESH") {
        checkpoint.consumedWclCalls += ESTIMATED_WCL_CALLS_PER_FULL_REFRESH;
      }
      checkpoint.processedCount += 1;
      checkpoint.cursor = Math.max(checkpoint.cursor, item.position + 1);
      checkpoint.lastCharacterId = item.characterId;
    } catch (error) {
      if (error instanceof CharacterDeletedError) {
        await repo.updateItemStatus(item.id, {
          status: "SKIPPED_CHARACTER_DELETED",
          skipReason: "CHARACTER_DELETED",
        });
        checkpoint.skippedCount += 1;
        checkpoint.processedCount += 1;
        checkpoint.cursor = Math.max(checkpoint.cursor, item.position + 1);
        continue;
      }
      const message = error instanceof Error ? error.message : String(error);
      // Leave PENDING so resume/restart can retry. Do not advance as dispatched.
      await repo.updateItemStatus(item.id, {
        status: "PENDING",
        error: { message, dispatchAttemptFailed: true },
        processedAt: null,
      });
      container.logger.warn(
        { err: error, bulkOperationId: fresh.id, characterId: item.characterId },
        "bulk item dispatch failed; left PENDING for retry",
      );
    }
  }

  await repo.saveCheckpoint(fresh.id, checkpoint, {
    enqueuedCount: checkpoint.enqueuedCount,
    dispatchedCount: checkpoint.dispatchedCount,
    dispatchFailedCount: checkpoint.dispatchFailedCount,
    skippedCount: checkpoint.skippedCount,
    consumedWclCalls: checkpoint.consumedWclCalls,
    status: "RUNNING",
  });

  const morePending = await repo.listPendingItems(fresh.id, 0, 1);
  if (morePending.length === 0) {
    const completed = await repo.markTerminal(fresh.id, "COMPLETED");
    return {
      ...baseResult,
      bulkOperationId: completed.id,
      status: completed.status,
      checkpoint,
      batchEnqueued,
      requeued: false,
      dryRun: false,
    };
  }

  // Avoid a hot requeue loop when every item in the tick failed dispatch and stayed PENDING.
  // Operation remains RUNNING; admin resume (or a later tick trigger) can retry.
  if (batchEnqueued === 0) {
    return {
      ...baseResult,
      bulkOperationId: fresh.id,
      status: "RUNNING",
      checkpoint,
      batchEnqueued: 0,
      requeued: false,
      dryRun: false,
    };
  }

  await producers.enqueueBulkCharacterProcessing({
    bulkOperationId: fresh.id,
    correlationId: job.correlationId ?? null,
  });

  return {
    ...baseResult,
    bulkOperationId: fresh.id,
    status: "RUNNING",
    checkpoint,
    batchEnqueued,
    requeued: true,
    dryRun: false,
  };
}

