import { Queue, type ConnectionOptions } from "bullmq";
import {
  QUEUE_NAMES,
  analyzeRunJobSchema,
  bulkOrchestratorJobSchema,
  discoverOwnedCharactersJobSchema,
  generateAddonExportJobSchema,
  recalculateScoreJobSchema,
  refreshCharacterJobSchema,
  type AnalyzeRunJob,
  type BulkOrchestratorJob,
  type DiscoverOwnedCharactersJob,
  type GenerateAddonExportJob,
  type RecalculateScoreJob,
  type RefreshCharacterJob,
} from "@mplus/contracts";
import type { WorkerContainer } from "./container.js";
import {
  analyzeRunDedupeKey,
  bulkCharacterProcessingDedupeKey,
  discoverOwnedCharactersDedupeKey,
  generateAddonExportDedupeKey,
  recalculateScoreDedupeKey,
  refreshCharacterDedupeKey,
} from "./dedupe.js";
import { persistAndEnqueue } from "./orchestration/enqueue.js";
import { runDiscoverOwnedCharacters } from "./orchestration/discover-owned-characters.js";

export interface EnqueueResult {
  jobId: string;
  dedupeKey: string;
  /** True when an existing non-terminal IngestionJob row was reused instead of created. */
  reused: boolean;
  /** True when a new BullMQ message was published for this call. */
  enqueued?: boolean;
}

const PRIORITY_WEIGHT: Record<"high" | "normal" | "low", number> = { high: 10, normal: 0, low: -10 };

export interface QueueProducers {
  enqueueRefreshCharacter(
    input: Omit<RefreshCharacterJob, "requestedAt"> & { requestedAt?: string },
  ): Promise<EnqueueResult>;
  enqueueAnalyzeRun(input: Omit<AnalyzeRunJob, "requestedAt"> & { requestedAt?: string }): Promise<EnqueueResult>;
  enqueueRecalculateScore(
    input: Omit<RecalculateScoreJob, "requestedAt"> & { requestedAt?: string },
  ): Promise<EnqueueResult>;
  enqueueGenerateAddonExport(
    input: Omit<GenerateAddonExportJob, "requestedAt"> & { requestedAt?: string },
  ): Promise<EnqueueResult>;
  enqueueDiscoverOwnedCharacters(
    input: Omit<DiscoverOwnedCharactersJob, "requestedAt"> & { requestedAt?: string },
  ): Promise<EnqueueResult>;
  enqueueBulkCharacterProcessing(
    input: Omit<BulkOrchestratorJob, "requestedAt"> & { requestedAt?: string },
  ): Promise<EnqueueResult>;
  /** Refresh-character queue for admin cancel/prioritize/kill-all. Null in inline mode. */
  getRefreshCharacterQueue(): Queue | null;
  close(): Promise<void>;
}

/**
 * Producers reconcile IngestionJob rows with BullMQ. Logical dedupe stays on `dedupeKey`;
 * each execution gets a unique BullMQ jobId so terminal Redis jobs never block requeue.
 */
export function createQueueProducers(
  connection: ConnectionOptions,
  container: WorkerContainer,
): QueueProducers {
  const queues = {
    [QUEUE_NAMES.refreshCharacter]: new Queue(QUEUE_NAMES.refreshCharacter, { connection }),
    [QUEUE_NAMES.analyzeRun]: new Queue(QUEUE_NAMES.analyzeRun, { connection }),
    [QUEUE_NAMES.recalculateScore]: new Queue(QUEUE_NAMES.recalculateScore, { connection }),
    [QUEUE_NAMES.generateAddonExport]: new Queue(QUEUE_NAMES.generateAddonExport, { connection }),
    [QUEUE_NAMES.discoverOwnedCharacters]: new Queue(QUEUE_NAMES.discoverOwnedCharacters, {
      connection,
    }),
    [QUEUE_NAMES.bulkCharacterProcessing]: new Queue(QUEUE_NAMES.bulkCharacterProcessing, {
      connection,
    }),
  } as const;

  async function enqueue(
    queue: Queue,
    jobType: string,
    dedupeKey: string,
    payload: unknown,
    options: { characterId?: string | null; runId?: string | null; priority?: number } = {},
  ): Promise<EnqueueResult> {
    const result = await persistAndEnqueue({
      queue,
      jobType,
      dedupeKey,
      payload,
      jobRepository: container.repositories.job,
      logger: container.logger,
      options,
    });
    return {
      jobId: result.jobId,
      dedupeKey: result.dedupeKey,
      reused: result.reused,
      enqueued: result.enqueued,
    };
  }

  const producers: QueueProducers = {
    async enqueueRefreshCharacter(input) {
      const payload = refreshCharacterJobSchema.parse({
        ...input,
        requestedAt: input.requestedAt ?? new Date().toISOString(),
      }) as RefreshCharacterJob;
      const dedupeKey = refreshCharacterDedupeKey(payload);
      return enqueue(queues[QUEUE_NAMES.refreshCharacter], QUEUE_NAMES.refreshCharacter, dedupeKey, payload, {
        characterId: payload.characterId ?? null,
        priority: PRIORITY_WEIGHT[payload.priority],
      });
    },

    async enqueueAnalyzeRun(input) {
      const payload = analyzeRunJobSchema.parse({
        ...input,
        requestedAt: input.requestedAt ?? new Date().toISOString(),
      });
      const dedupeKey = analyzeRunDedupeKey(payload);
      return enqueue(queues[QUEUE_NAMES.analyzeRun], QUEUE_NAMES.analyzeRun, dedupeKey, payload, {
        characterId: payload.characterId,
        runId: payload.runId,
      });
    },

    async enqueueRecalculateScore(input) {
      const payload = recalculateScoreJobSchema.parse({
        ...input,
        requestedAt: input.requestedAt ?? new Date().toISOString(),
      });
      const dedupeKey = recalculateScoreDedupeKey(payload);
      return enqueue(
        queues[QUEUE_NAMES.recalculateScore],
        QUEUE_NAMES.recalculateScore,
        dedupeKey,
        payload,
        { characterId: payload.characterId },
      );
    },

    async enqueueGenerateAddonExport(input) {
      const payload = generateAddonExportJobSchema.parse({
        ...input,
        requestedAt: input.requestedAt ?? new Date().toISOString(),
      });
      const dedupeKey = generateAddonExportDedupeKey(payload);
      return enqueue(
        queues[QUEUE_NAMES.generateAddonExport],
        QUEUE_NAMES.generateAddonExport,
        dedupeKey,
        payload,
      );
    },

    async enqueueDiscoverOwnedCharacters(input) {
      const payload = discoverOwnedCharactersJobSchema.parse({
        ...input,
        requestedAt: input.requestedAt ?? new Date().toISOString(),
      });
      const dedupeKey = discoverOwnedCharactersDedupeKey(payload);
      const result = await enqueue(
        queues[QUEUE_NAMES.discoverOwnedCharacters],
        QUEUE_NAMES.discoverOwnedCharacters,
        dedupeKey,
        payload,
      );
      await container.prisma.battleNetAccount.updateMany({
        where: { id: payload.battleNetAccountId },
        data: {
          lastDiscoveryJobId: result.jobId,
          ...(result.reused && !result.enqueued
            ? {}
            : { lastDiscoveryStatus: "QUEUED", lastDiscoveryError: null }),
        },
      });
      return result;
    },

    async enqueueBulkCharacterProcessing(input) {
      const payload = bulkOrchestratorJobSchema.parse({
        ...input,
        requestedAt: input.requestedAt ?? new Date().toISOString(),
      });
      const dedupeKey = bulkCharacterProcessingDedupeKey(payload);
      return enqueue(
        queues[QUEUE_NAMES.bulkCharacterProcessing],
        QUEUE_NAMES.bulkCharacterProcessing,
        dedupeKey,
        payload,
        { priority: PRIORITY_WEIGHT.low },
      );
    },

    getRefreshCharacterQueue() {
      return queues[QUEUE_NAMES.refreshCharacter] ?? null;
    },

    async close() {
      await Promise.all(Object.values(queues).map((queue) => queue.close()));
    },
  };

  return producers;
}

/** Used by discovery worker: producers need enqueueRefreshCharacter only. */
export type DiscoveryRefreshProducers = Pick<QueueProducers, "enqueueRefreshCharacter">;

export type BulkOrchestratorProducers = Pick<
  QueueProducers,
  "enqueueRefreshCharacter" | "enqueueRecalculateScore" | "enqueueBulkCharacterProcessing"
>;

export async function processDiscoverOwnedCharactersJob(
  container: WorkerContainer,
  producers: DiscoveryRefreshProducers,
  data: unknown,
): Promise<unknown> {
  const payload = discoverOwnedCharactersJobSchema.parse(data);
  return runDiscoverOwnedCharacters(container, payload, producers);
}
