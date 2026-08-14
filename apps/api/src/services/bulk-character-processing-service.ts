import type {
  BulkCharacterProcessingInput,
  BulkOperationDetailDTO,
  BulkOperationDTO,
  BulkOperationItemDTO,
  BulkOperationItemStatus,
  BulkOperationStatus,
  BulkMode,
  BulkSelectionMode,
} from "@mplus/contracts";
import {
  BULK_OPERATION_ITEMS_DETAIL_LIMIT,
  BULK_EXPLICIT_CHARACTER_IDS_MAX,
  bulkCharacterProcessingInputSchema,
  isExplicitBulkCharacterSelection,
} from "@mplus/contracts";
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

export function selectionModeFromConfigSnapshot(snapshot: unknown): BulkSelectionMode {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return "COHORT";
  }
  const ids = (snapshot as { characterIds?: unknown }).characterIds;
  return Array.isArray(ids) && ids.length > 0 ? "EXPLICIT" : "COHORT";
}

export function mapBulkOperation(operation: BulkOperation): BulkOperationDTO {
  return {
    id: operation.id,
    mode: operation.mode as BulkMode,
    status: operation.status as BulkOperationStatus,
    completionSemantics: "CHILD_DISPATCH_FINISHED",
    childOutcomesTracked: false,
    selectionMode: selectionModeFromConfigSnapshot(operation.configSnapshot),
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
    let input: BulkCharacterProcessingInput;
    try {
      input = bulkCharacterProcessingInputSchema.parse(rawInput);
    } catch (error) {
      const issues =
        error && typeof error === "object" && "issues" in error
          ? (error as { issues: Array<{ message: string }> }).issues
          : null;
      throw HttpError.badRequest(
        "BULK_OPERATION_INVALID_INPUT",
        issues?.map((issue) => issue.message).join("; ") ||
          (error instanceof Error ? error.message : "Invalid bulk operation input"),
        error,
      );
    }

    if (isExplicitBulkCharacterSelection(input)) {
      const missing = await this.repo.findMissingCharacterIds(input.characterIds!);
      if (missing.length > 0) {
        throw HttpError.badRequest(
          "BULK_CHARACTERS_NOT_FOUND",
          `Selected characters were not found: ${missing.slice(0, 20).join(", ")}${missing.length > 20 ? "…" : ""}`,
          { missingCharacterIds: missing },
        );
      }
    }

    const logicalKey = buildBulkLogicalKey({
      mode: input.mode,
      minMythicPlusScore: input.minMythicPlusScore,
      scoreModelId: input.scoreModelId ?? null,
      dryRun: input.dryRun,
      allowFullRefreshOnIncompatible: input.allowFullRefreshOnIncompatible,
      logicalKey: input.logicalKey,
      characterIds: input.characterIds,
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
        configSnapshot: input as unknown as Record<string, unknown>,
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
        characterIds: null,
      },
      { createdByUserId: opts.createdByUserId ?? null },
    );
  }

  /**
   * Season-targeted RECALCULATE_ONLY after a context-policy publish.
   * Does not rescore in-request. Provider-free child jobs reuse persisted evidence.
   */
  async enqueueRecalculateForSeasonScores(
    input: {
      seasonId: string;
      scoreModelId: string | null;
      characterIds: string[];
      createdByUserId?: string | null;
    },
  ): Promise<BulkOperationDTO | null> {
    if (input.characterIds.length === 0) return null;
    let first: BulkOperationDTO | null = null;
    for (let offset = 0; offset < input.characterIds.length; offset += BULK_EXPLICIT_CHARACTER_IDS_MAX) {
      const chunk = input.characterIds.slice(offset, offset + BULK_EXPLICIT_CHARACTER_IDS_MAX);
      const chunkIndex = Math.floor(offset / BULK_EXPLICIT_CHARACTER_IDS_MAX);
      const operation = await this.create(
        {
          mode: "RECALCULATE_ONLY",
          minMythicPlusScore: null,
          scoreModelId: input.scoreModelId,
          batchSize: 25,
          maxCharacters: null,
          maxWclCalls: null,
          dryRun: false,
          allowFullRefreshOnIncompatible: false,
          logicalKey: `season-context:${input.seasonId}:chunk:${chunkIndex}`,
          characterIds: chunk,
          pinnedSeasonId: input.seasonId,
        },
        { createdByUserId: input.createdByUserId ?? null },
      );
      first ??= operation;
    }
    return first;
  }

  async list(limit = 50): Promise<BulkOperationDTO[]> {
    const rows = await this.repo.listRecent(limit);
    return rows.map(mapBulkOperation);
  }

  async get(
    id: string,
    itemLimit = BULK_OPERATION_ITEMS_DETAIL_LIMIT,
  ): Promise<BulkOperationDetailDTO> {
    const row = await this.repo.findByIdWithItems(id, itemLimit);
    if (!row) {
      throw HttpError.notFound("BULK_OPERATION_NOT_FOUND", `Bulk operation ${id} was not found`);
    }
    const itemsTotal = row.itemsTotal;
    return {
      ...mapBulkOperation(row),
      items: row.items.map(mapBulkOperationItem),
      itemsTotal,
      itemsLimit: itemLimit,
      itemsTruncated: itemsTotal > row.items.length,
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
