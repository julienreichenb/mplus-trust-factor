import { Queue, type ConnectionOptions } from "bullmq";
import {
  QUEUE_NAMES,
  analyzeRunJobSchema,
  generateAddonExportJobSchema,
  recalculateScoreJobSchema,
  refreshCharacterJobSchema,
  type AnalyzeRunJob,
  type GenerateAddonExportJob,
  type RecalculateScoreJob,
  type RefreshCharacterJob,
} from "@mplus/contracts";
import type { WorkerContainer } from "./container.js";
import {
  analyzeRunDedupeKey,
  generateAddonExportDedupeKey,
  recalculateScoreDedupeKey,
  refreshCharacterDedupeKey,
} from "./dedupe.js";

export interface EnqueueResult {
  jobId: string;
  dedupeKey: string;
  /** True when an existing non-terminal IngestionJob row was reused instead of created. */
  reused: boolean;
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
  close(): Promise<void>;
}

/**
 * Producers persist an `IngestionJob` row keyed by the queue's dedupe key, then enqueue a BullMQ
 * job with `jobId = dedupeKey` so duplicate refresh/analyze/recalculate/export requests collapse.
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
  } as const;

  async function persistAndEnqueue(
    queue: Queue,
    jobType: string,
    dedupeKey: string,
    payload: unknown,
    options: { characterId?: string | null; runId?: string | null; priority?: number } = {},
  ): Promise<EnqueueResult> {
    const { job, reused } = await container.repositories.job.createOrGetByDedupe({
      jobType,
      dedupeKey,
      characterId: options.characterId ?? null,
      runId: options.runId ?? null,
      payload,
      priority: options.priority ?? 0,
    });

    try {
      await queue.add(jobType, payload, {
        jobId: dedupeKey,
        removeOnComplete: 1000,
        removeOnFail: 1000,
      });
    } catch (error) {
      container.logger.warn({ jobType, dedupeKey, err: error }, "queue.add skipped (job already enqueued)");
    }

    return { jobId: job.id, dedupeKey, reused };
  }

  return {
    async enqueueRefreshCharacter(input) {
      const payload = refreshCharacterJobSchema.parse({
        ...input,
        requestedAt: input.requestedAt ?? new Date().toISOString(),
      }) as RefreshCharacterJob;
      const dedupeKey = refreshCharacterDedupeKey(payload);
      return persistAndEnqueue(
        queues[QUEUE_NAMES.refreshCharacter],
        QUEUE_NAMES.refreshCharacter,
        dedupeKey,
        payload,
        { characterId: payload.characterId ?? null, priority: PRIORITY_WEIGHT[payload.priority] },
      );
    },

    async enqueueAnalyzeRun(input) {
      const payload = analyzeRunJobSchema.parse({
        ...input,
        requestedAt: input.requestedAt ?? new Date().toISOString(),
      });
      const dedupeKey = analyzeRunDedupeKey(payload);
      return persistAndEnqueue(queues[QUEUE_NAMES.analyzeRun], QUEUE_NAMES.analyzeRun, dedupeKey, payload, {
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
      return persistAndEnqueue(
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
      return persistAndEnqueue(
        queues[QUEUE_NAMES.generateAddonExport],
        QUEUE_NAMES.generateAddonExport,
        dedupeKey,
        payload,
      );
    },

    async close() {
      await Promise.all(Object.values(queues).map((queue) => queue.close()));
    },
  };
}
