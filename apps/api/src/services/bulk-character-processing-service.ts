import type {
  BulkCharacterProcessingInput,
  BulkOperationDetailDTO,
  BulkOperationDTO,
  BulkOperationItemDTO,
  BulkOperationItemStatus,
  BulkOperationStatus,
  BulkMode,
} from "@mplus/contracts";
import { bulkCharacterProcessingInputSchema } from "@mplus/contracts";
import { Prisma, type BulkOperation, type BulkOperationItem } from "@mplus/database";
import type { ApiContainer } from "../container.js";
import { HttpError } from "../errors.js";
import { buildBulkLogicalKey } from "@mplus/worker";

function mapProgress(operation: BulkOperation): BulkOperationDTO["progress"] {
  const checkpoint =
    operation.checkpoint && typeof operation.checkpoint === "object" && !Array.isArray(operation.checkpoint)
      ? (operation.checkpoint as Record<string, unknown>)
      : {};
  const cursor = typeof checkpoint.cursor === "number" ? checkpoint.cursor : 0;
  return {
    selectedCount: operation.selectedCount,
    skippedCount: operation.skippedCount,
    dispatchedCount: operation.dispatchedCount,
    enqueuedCount: operation.enqueuedCount,
    dispatchFailedCount: operation.dispatchFailedCount,
    estimatedWclCalls: operation.estimatedWclCalls,
    consumedWclCalls: operation.consumedWclCalls,
    cursor,
  };
}

function errorMessage(error: unknown): string | null {
  if (!error || typeof error !== "object" || Array.isArray(error)) {
    return null;
  }
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message : null;
}

export function mapBulkOperation(operation: BulkOperation): BulkOperationDTO {
  return {
    id: operation.id,
    mode: operation.mode as BulkMode,
    status: operation.status as BulkOperationStatus,
    completionSemantics: "CHILD_DISPATCH_FINISHED",
    childOutcomesTracked: false,
    logicalKey: operation.logicalKey,
    minMythicPlusScore: operation.minMythicPlusScore,
    scoreModelId: operation.scoreModelId,
    batchSize: operation.batchSize,
    maxCharacters: operation.maxCharacters,
    maxWclCalls: operation.maxWclCalls,
    dryRun: operation.dryRun,
    allowFullRefreshOnIncompatible: operation.allowFullRefreshOnIncompatible,
    selectionFingerprint: operation.selectionFingerprint,
    progress: mapProgress(operation),
    createdByUserId: operation.createdByUserId,
    cancelRequestedAt: operation.cancelRequestedAt?.toISOString() ?? null,
    pauseRequestedAt: operation.pauseRequestedAt?.toISOString() ?? null,
    errorMessage: errorMessage(operation.error),
    startedAt: operation.startedAt?.toISOString() ?? null,
    completedAt: operation.completedAt?.toISOString() ?? null,
    createdAt: operation.createdAt.toISOString(),
    updatedAt: operation.updatedAt.toISOString(),
  };
}

export function mapBulkOperationItem(item: BulkOperationItem): BulkOperationItemDTO {
  return {
    id: item.id,
    bulkOperationId: item.bulkOperationId,
    characterId: item.characterId,
    position: item.position,
    status: item.status as BulkOperationItemStatus,
    region: item.region,
    realmSlug: item.realmSlug,
    characterName: item.characterName,
    mythicPlusScore: item.mythicPlusScore,
    evidenceCompatible: item.evidenceCompatible,
    skipReason: item.skipReason,
    errorMessage: errorMessage(item.error),
    childJobId: item.childJobId,
    childJobType: item.childJobType,
    processedAt: item.processedAt?.toISOString() ?? null,
  };
}

function activeLogicalKeyConflict(logicalKey: string, existingOperationId: string): HttpError {
  return HttpError.conflict(
    "BULK_OPERATION_ACTIVE",
    `An active bulk operation already exists for logical key "${logicalKey}"`,
    { existingOperationId },
  );
}

/**
 * Admin-controlled bulk cohort API. Stable entry point for Agent 08 model activation:
 * `enqueueRecalculateAllForModel(scoreModelId)`.
 */
export class BulkCharacterProcessingService {
  constructor(private readonly container: ApiContainer) {}

  private get repo() {
    return this.container.worker.repositories.bulkOperation;
  }

  async create(
    rawInput: BulkCharacterProcessingInput,
    opts: { createdByUserId?: string | null } = {},
  ): Promise<BulkOperationDTO> {
    const input = bulkCharacterProcessingInputSchema.parse(rawInput);
    const logicalKey = buildBulkLogicalKey({
      mode: input.mode,
      minMythicPlusScore: input.minMythicPlusScore,
      scoreModelId: input.scoreModelId ?? null,
      dryRun: input.dryRun,
      allowFullRefreshOnIncompatible: input.allowFullRefreshOnIncompatible,
      logicalKey: input.logicalKey,
    });

    const existing = await this.repo.findActiveByLogicalKey(logicalKey);
    if (existing) {
      throw activeLogicalKeyConflict(logicalKey, existing.id);
    }

    if (input.scoreModelId) {
      const model = await this.container.worker.repositories.score.getModelById(input.scoreModelId);
      if (!model) {
        throw HttpError.notFound("SCORE_MODEL_NOT_FOUND", `Score model ${input.scoreModelId} was not found`);
      }
    }

    let operation: BulkOperation;
    try {
      operation = await this.repo.create({
        mode: input.mode,
        logicalKey,
        minMythicPlusScore: input.minMythicPlusScore,
        scoreModelId: input.scoreModelId ?? null,
        batchSize: input.batchSize,
        maxCharacters: input.maxCharacters ?? null,
        maxWclCalls: input.maxWclCalls ?? null,
        dryRun: input.dryRun,
        allowFullRefreshOnIncompatible: input.allowFullRefreshOnIncompatible,
        createdByUserId: opts.createdByUserId ?? null,
        configSnapshot: input,
      });
    } catch (error) {
      // Concurrent create raced past the pre-check; partial unique index enforces one active key.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const raced = await this.repo.findActiveByLogicalKey(logicalKey);
        if (raced) {
          throw activeLogicalKeyConflict(logicalKey, raced.id);
        }
        throw HttpError.conflict(
          "BULK_OPERATION_ACTIVE",
          `An active bulk operation already exists for logical key "${logicalKey}"`,
        );
      }
      throw error;
    }

    await this.container.producers.enqueueBulkCharacterProcessing({
      bulkOperationId: operation.id,
      correlationId: null,
    });

    const fresh = await this.repo.findById(operation.id);
    return mapBulkOperation(fresh ?? operation);
  }

  /**
   * Stable Agent-08 integration: progressive RECALCULATE_ONLY for all persisted characters
   * against the newly activated score model id.
   */
  async enqueueRecalculateAllForModel(
    scoreModelId: string,
    opts: {
      createdByUserId?: string | null;
      batchSize?: number;
      dryRun?: boolean;
      logicalKey?: string;
    } = {},
  ): Promise<BulkOperationDTO> {
    return this.create(
      {
        mode: "RECALCULATE_ONLY",
        minMythicPlusScore: null,
        scoreModelId,
        batchSize: opts.batchSize ?? 25,
        maxCharacters: null,
        maxWclCalls: null,
        dryRun: opts.dryRun ?? false,
        allowFullRefreshOnIncompatible: false,
        logicalKey: opts.logicalKey ?? `model-activate:${scoreModelId}`,
      },
      { createdByUserId: opts.createdByUserId ?? null },
    );
  }

  async list(limit = 50): Promise<BulkOperationDTO[]> {
    const rows = await this.repo.listRecent(limit);
    return rows.map(mapBulkOperation);
  }

  async get(id: string): Promise<BulkOperationDetailDTO> {
    const row = await this.repo.findByIdWithItems(id);
    if (!row) {
      throw HttpError.notFound("BULK_OPERATION_NOT_FOUND", `Bulk operation ${id} was not found`);
    }
    return {
      ...mapBulkOperation(row),
      items: row.items.map(mapBulkOperationItem),
    };
  }

  async pause(id: string): Promise<BulkOperationDTO> {
    const existing = await this.repo.findById(id);
    if (!existing) {
      throw HttpError.notFound("BULK_OPERATION_NOT_FOUND", `Bulk operation ${id} was not found`);
    }
    if (!["PENDING", "SELECTING", "RUNNING"].includes(existing.status)) {
      throw HttpError.conflict("BULK_OPERATION_NOT_PAUSABLE", `Cannot pause operation in status ${existing.status}`);
    }
    const updated = await this.repo.requestPause(id);
    return mapBulkOperation(updated);
  }

  async resume(id: string): Promise<BulkOperationDTO> {
    const existing = await this.repo.findById(id);
    if (!existing) {
      throw HttpError.notFound("BULK_OPERATION_NOT_FOUND", `Bulk operation ${id} was not found`);
    }
    if (existing.status !== "PAUSED" && !existing.pauseRequestedAt) {
      throw HttpError.conflict("BULK_OPERATION_NOT_RESUMABLE", `Cannot resume operation in status ${existing.status}`);
    }
    const updated = await this.repo.resume(id);
    await this.container.producers.enqueueBulkCharacterProcessing({
      bulkOperationId: updated.id,
      correlationId: null,
    });
    return mapBulkOperation(updated);
  }

  async cancel(id: string): Promise<BulkOperationDTO> {
    const existing = await this.repo.findById(id);
    if (!existing) {
      throw HttpError.notFound("BULK_OPERATION_NOT_FOUND", `Bulk operation ${id} was not found`);
    }
    if (["COMPLETED", "CANCELLED", "FAILED", "DRY_RUN_COMPLETED"].includes(existing.status)) {
      throw HttpError.conflict(
        "BULK_OPERATION_NOT_CANCELLABLE",
        `Cannot cancel operation in status ${existing.status}`,
      );
    }
    const updated = await this.repo.requestCancel(id);
    if (updated.status === "PAUSED" || updated.status === "PENDING") {
      // Ensure a tick runs to apply cancellation when no worker is currently looping.
      await this.container.producers.enqueueBulkCharacterProcessing({
        bulkOperationId: updated.id,
        correlationId: null,
      });
    }
    return mapBulkOperation(updated);
  }
}
