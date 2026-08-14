import {
  Prisma,
  type BulkOperation,
  type BulkOperationItem,
  type BulkOperationItemStatus,
  type BulkOperationMode,
  type BulkOperationStatus,
  type PrismaClient,
} from "@mplus/database";
import {
  bulkCheckpointToJson,
  emptyBulkCheckpoint,
  parseBulkCheckpoint,
  type BulkOrchestratorCheckpoint,
} from "../orchestration/bulk-checkpoint.js";
import type { BulkSelectedItem } from "../orchestration/bulk-character-selection.js";
import { toInputJsonValue } from "./prisma-json.js";

const ACTIVE_STATUSES: BulkOperationStatus[] = ["PENDING", "SELECTING", "RUNNING", "PAUSED"];

export interface CreateBulkOperationRecordInput {
  mode: BulkOperationMode;
  logicalKey: string;
  minMythicPlusScore: number | null;
  scoreModelId: string | null;
  batchSize: number;
  maxCharacters: number | null;
  maxWclCalls: number | null;
  dryRun: boolean;
  allowFullRefreshOnIncompatible: boolean;
  createdByUserId: string | null;
  configSnapshot: Record<string, unknown>;
}

export interface BulkOperationWithItems extends BulkOperation {
  items: BulkOperationItem[];
  itemsTotal: number;
}

export type BulkSelectableCharacterRow = {
  characterId: string;
  region: string;
  regionId: string;
  realmSlug: string;
  name: string;
  mythicPlusScore: number | null;
  seasonId: string | null;
  seasonSlug: string | null;
  /** Persisted catalog WCL zone for the effective scoring season; null if catalog incomplete. */
  wclZoneId: number | null;
  hasSeasonObservations: boolean;
  observationSchemaVersions: Array<string | null>;
  storedRefreshContract: unknown | null;
};

export interface BulkOperationRepository {
  findById(id: string): Promise<BulkOperation | null>;
  findByIdWithItems(id: string, itemLimit?: number): Promise<BulkOperationWithItems | null>;
  listRecent(limit?: number): Promise<BulkOperation[]>;
  findActiveByLogicalKey(logicalKey: string): Promise<BulkOperation | null>;
  create(input: CreateBulkOperationRecordInput): Promise<BulkOperation>;
  markSelecting(id: string): Promise<BulkOperation>;
  saveSelection(
    id: string,
    input: {
      selectionFingerprint: string;
      estimatedWclCalls: number;
      items: BulkSelectedItem[];
      dryRun: boolean;
      checkpoint: BulkOrchestratorCheckpoint;
    },
  ): Promise<BulkOperation>;
  saveCheckpoint(
    id: string,
    checkpoint: BulkOrchestratorCheckpoint,
    counts: {
      enqueuedCount: number;
      dispatchedCount: number;
      dispatchFailedCount: number;
      skippedCount: number;
      consumedWclCalls: number;
      status?: BulkOperationStatus;
    },
  ): Promise<BulkOperation>;
  updateItemStatus(
    itemId: string,
    patch: {
      status: BulkOperationItemStatus;
      skipReason?: string | null;
      error?: Record<string, unknown> | null;
      childJobId?: string | null;
      childJobType?: string | null;
      evidenceCompatible?: boolean | null;
      processedAt?: Date | null;
    },
  ): Promise<BulkOperationItem>;
  listPendingItems(operationId: string, fromPosition: number, limit: number): Promise<BulkOperationItem[]>;
  requestPause(id: string): Promise<BulkOperation>;
  requestCancel(id: string): Promise<BulkOperation>;
  resume(id: string): Promise<BulkOperation>;
  markTerminal(
    id: string,
    status: Extract<BulkOperationStatus, "COMPLETED" | "CANCELLED" | "FAILED" | "DRY_RUN_COMPLETED" | "PAUSED">,
    error?: Record<string, unknown> | null,
  ): Promise<BulkOperation>;
  parseCheckpoint(operation: BulkOperation): BulkOrchestratorCheckpoint;
  /**
   * Load selectable character rows. When `characterIds` is non-empty, only those IDs are loaded
   * (order of the returned array is undefined — callers reorder by picker order).
   */
  listSelectableCharacters(
    characterIds?: string[] | null,
    pinnedSeasonId?: string | null,
  ): Promise<BulkSelectableCharacterRow[]>;
  /** Returns which of the given IDs are missing from the character table. */
  findMissingCharacterIds(characterIds: string[]): Promise<string[]>;
}

export function createBulkOperationRepository(prisma: PrismaClient): BulkOperationRepository {
  return {
    findById(id) {
      return prisma.bulkOperation.findUnique({ where: { id } });
    },

    async findByIdWithItems(id, itemLimit = 200) {
      const operation = await prisma.bulkOperation.findUnique({
        where: { id },
        include: {
          items: {
            orderBy: { position: "asc" },
            take: itemLimit,
          },
          _count: { select: { items: true } },
        },
      });
      if (!operation) return null;
      const { _count, ...rest } = operation;
      return { ...rest, itemsTotal: _count.items };
    },

    listRecent(limit = 50) {
      return prisma.bulkOperation.findMany({
        orderBy: { createdAt: "desc" },
        take: limit,
      });
    },

    findActiveByLogicalKey(logicalKey) {
      return prisma.bulkOperation.findFirst({
        where: {
          logicalKey,
          status: { in: ACTIVE_STATUSES },
        },
        orderBy: { createdAt: "desc" },
      });
    },

    create(input) {
      return prisma.bulkOperation.create({
        data: {
          mode: input.mode,
          status: "PENDING",
          logicalKey: input.logicalKey,
          minMythicPlusScore: input.minMythicPlusScore,
          scoreModelId: input.scoreModelId,
          batchSize: input.batchSize,
          maxCharacters: input.maxCharacters,
          maxWclCalls: input.maxWclCalls,
          dryRun: input.dryRun,
          allowFullRefreshOnIncompatible: input.allowFullRefreshOnIncompatible,
          createdByUserId: input.createdByUserId,
          configSnapshot: toInputJsonValue(input.configSnapshot),
          checkpoint: toInputJsonValue(bulkCheckpointToJson(emptyBulkCheckpoint())),
        },
      });
    },

    markSelecting(id) {
      return prisma.bulkOperation.update({
        where: { id },
        data: {
          status: "SELECTING",
          startedAt: new Date(),
        },
      });
    },

    async saveSelection(id, input) {
      return prisma.$transaction(async (tx) => {
        await tx.bulkOperationItem.createMany({
          data: input.items.map((item) => ({
            bulkOperationId: id,
            characterId: item.characterId,
            position: item.position,
            status:
              item.disposition === "SKIP_INCOMPATIBLE"
                ? "SKIPPED_INCOMPATIBLE"
                : input.dryRun
                  ? "SKIPPED_DRY_RUN"
                  : "PENDING",
            region: item.region,
            realmSlug: item.realmSlug,
            characterName: item.name,
            mythicPlusScore: item.mythicPlusScore,
            evidenceCompatible: item.evidenceCompatible,
            skipReason: item.skipReason,
          })),
          skipDuplicates: true,
        });

        const skippedCount = input.items.filter(
          (item) => item.disposition === "SKIP_INCOMPATIBLE" || input.dryRun,
        ).length;

        return tx.bulkOperation.update({
          where: { id },
          data: {
            status: input.dryRun ? "DRY_RUN_COMPLETED" : "RUNNING",
            selectionFingerprint: input.selectionFingerprint,
            selectedCount: input.items.length,
            skippedCount,
            estimatedWclCalls: input.estimatedWclCalls,
            checkpoint: toInputJsonValue(
              bulkCheckpointToJson({
                ...input.checkpoint,
                selectionComplete: true,
                skippedCount,
              }),
            ),
            completedAt: input.dryRun ? new Date() : null,
          },
        });
      });
    },

    saveCheckpoint(id, checkpoint, counts) {
      return prisma.bulkOperation.update({
        where: { id },
        data: {
          checkpoint: toInputJsonValue(bulkCheckpointToJson(checkpoint)),
          enqueuedCount: counts.enqueuedCount,
          dispatchedCount: counts.dispatchedCount,
          dispatchFailedCount: counts.dispatchFailedCount,
          skippedCount: counts.skippedCount,
          consumedWclCalls: counts.consumedWclCalls,
          ...(counts.status ? { status: counts.status } : {}),
        },
      });
    },

    updateItemStatus(itemId, patch) {
      return prisma.bulkOperationItem.update({
        where: { id: itemId },
        data: {
          status: patch.status,
          skipReason: patch.skipReason === undefined ? undefined : patch.skipReason,
          error:
            patch.error === undefined
              ? undefined
              : patch.error === null
                ? Prisma.DbNull
                : toInputJsonValue(patch.error),
          childJobId: patch.childJobId === undefined ? undefined : patch.childJobId,
          childJobType: patch.childJobType === undefined ? undefined : patch.childJobType,
          evidenceCompatible:
            patch.evidenceCompatible === undefined ? undefined : patch.evidenceCompatible,
          processedAt:
            patch.processedAt === undefined
              ? patch.status === "PENDING"
                ? null
                : new Date()
              : patch.processedAt,
        },
      });
    },

    listPendingItems(operationId, fromPosition, limit) {
      return prisma.bulkOperationItem.findMany({
        where: {
          bulkOperationId: operationId,
          status: "PENDING",
          position: { gte: fromPosition },
        },
        orderBy: { position: "asc" },
        take: limit,
      });
    },

    requestPause(id) {
      return prisma.bulkOperation.update({
        where: { id },
        data: {
          pauseRequestedAt: new Date(),
        },
      });
    },

    requestCancel(id) {
      return prisma.bulkOperation.update({
        where: { id },
        data: {
          cancelRequestedAt: new Date(),
        },
      });
    },

    resume(id) {
      return prisma.bulkOperation.update({
        where: { id },
        data: {
          status: "RUNNING",
          pauseRequestedAt: null,
        },
      });
    },

    markTerminal(id, status, error = null) {
      return prisma.bulkOperation.update({
        where: { id },
        data: {
          status,
          completedAt: status === "PAUSED" ? null : new Date(),
          error: error === null ? undefined : toInputJsonValue(error),
        },
      });
    },

    parseCheckpoint(operation) {
      return parseBulkCheckpoint(operation.checkpoint);
    },

    async findMissingCharacterIds(characterIds) {
      if (characterIds.length === 0) return [];
      const found = await prisma.character.findMany({
        where: { id: { in: characterIds } },
        select: { id: true },
      });
      const foundSet = new Set(found.map((row) => row.id));
      return characterIds.filter((id) => !foundSet.has(id));
    },

    async listSelectableCharacters(characterIds, pinnedSeasonId) {
      const explicit = characterIds != null && characterIds.length > 0;
      const characters = await prisma.character.findMany({
        where: explicit ? { id: { in: characterIds } } : undefined,
        select: {
          id: true,
          displayName: true,
          regionId: true,
          region: { select: { code: true } },
          realm: { select: { slug: true } },
          snapshots: {
            orderBy: { capturedAt: "desc" },
            take: 1,
            select: { mythicRating: true },
          },
        },
        orderBy: [{ id: "asc" }],
      });

      const { readActiveMplusCatalogMetadata } = await import(
        "../orchestration/active-mplus-season/catalog-metadata.js"
      );

      const seasonByRegion = new Map<
        string,
        { id: string; slug: string; wclZoneId: number | null }
      >();

      if (pinnedSeasonId) {
        const pinned = await prisma.season.findUnique({
          where: { id: pinnedSeasonId },
          select: { id: true, slug: true, metadata: true },
        });
        if (pinned) {
          const overlay = {
            id: pinned.id,
            slug: pinned.slug,
            wclZoneId: readActiveMplusCatalogMetadata(pinned.metadata)?.wclZoneId ?? null,
          };
          for (const character of characters) {
            seasonByRegion.set(character.regionId, overlay);
          }
        }
      } else {
        const regionIds = [...new Set(characters.map((c) => c.regionId))];
        const { mapEffectiveScoringSeasonIdsByRegion } = await import(
          "../orchestration/active-mplus-season/effective-season-peek.js"
        );
        const seasonIdByRegion = await mapEffectiveScoringSeasonIdsByRegion(
          prisma,
          regionIds,
        );
        const seasonRows =
          seasonIdByRegion.size === 0
            ? []
            : await prisma.season.findMany({
                where: { id: { in: [...seasonIdByRegion.values()] } },
                select: { id: true, slug: true, regionId: true, metadata: true },
              });
        for (const [regionId, seasonId] of seasonIdByRegion) {
          const row = seasonRows.find((s) => s.id === seasonId);
          if (row) {
            seasonByRegion.set(regionId, {
              id: row.id,
              slug: row.slug,
              wclZoneId: readActiveMplusCatalogMetadata(row.metadata)?.wclZoneId ?? null,
            });
          }
        }
      }

      const result: BulkSelectableCharacterRow[] = [];

      for (const character of characters) {
        const season = seasonByRegion.get(character.regionId) ?? null;

        let hasSeasonObservations = false;
        let observationSchemaVersions: Array<string | null> = [];
        let storedRefreshContract: unknown | null = null;

        if (season) {
          const observations = await prisma.metricObservation.findMany({
            where: { characterId: character.id, seasonId: season.id },
            select: { schemaVersion: true },
            take: 50,
          });
          hasSeasonObservations = observations.length > 0;
          observationSchemaVersions = observations.map((o) => o.schemaVersion);

          const snapshot = await prisma.scoreSnapshot.findFirst({
            where: { characterId: character.id, seasonId: season.id },
            orderBy: { calculatedAt: "desc" },
            select: { explanation: true },
          });
          if (snapshot?.explanation && typeof snapshot.explanation === "object") {
            const explanation = snapshot.explanation as Record<string, unknown>;
            storedRefreshContract = explanation.refreshContract ?? null;
          }
        }

        result.push({
          characterId: character.id,
          region: character.region.code,
          regionId: character.regionId,
          realmSlug: character.realm.slug,
          name: character.displayName,
          mythicPlusScore: character.snapshots[0]?.mythicRating ?? null,
          seasonId: season?.id ?? null,
          seasonSlug: season?.slug ?? null,
          wclZoneId: season?.wclZoneId ?? null,
          hasSeasonObservations,
          observationSchemaVersions,
          storedRefreshContract,
        });
      }

      return result;
    },
  };
}
