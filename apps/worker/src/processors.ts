import { Queue, Worker, type ConnectionOptions, type Job } from "bullmq";
import {
  QUEUE_NAMES,
  analyzeRunJobSchema,
  bulkOrchestratorJobSchema,
  discoverOwnedCharactersJobSchema,
  generateAddonExportJobSchema,
  recalculateScoreJobSchema,
  refreshCharacterJobSchema,
} from "@mplus/contracts";
import { toJsonSafeSanitized } from "@mplus/observability";
import type { WorkerContainer } from "./container.js";
import {
  bulkCharacterProcessingDedupeKey,
  recalculateScoreDedupeKey,
  refreshCharacterDedupeKey,
} from "./dedupe.js";
import { persistAndEnqueue } from "./orchestration/enqueue.js";
import { runAnalyzeRun } from "./orchestration/analyze-run.js";
import { runBulkCharacterProcessing } from "./orchestration/bulk-character-processing.js";
import { runDiscoverOwnedCharacters } from "./orchestration/discover-owned-characters.js";
import { runGenerateAddonExport } from "./orchestration/generate-addon-export.js";
import { runRecalculateScore } from "./orchestration/recalculate-score.js";
import { runRefreshPipeline } from "./orchestration/refresh-pipeline.js";
import { classifyError } from "./orchestration/retry-classification.js";
import type { BulkOrchestratorProducers, DiscoveryRefreshProducers } from "./queues.js";

/** BullMQ JSON-encodes job return values; Prisma may include BigInt. Secrets/report codes are stripped. */
export function toBullmqReturnValue(value: unknown): unknown {
  return toJsonSafeSanitized(value);
}

/** Runs `fn`; non-retryable failures call `job.discard()` so BullMQ does not schedule further attempts. */
async function withRetryClassification<T>(job: Job, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const classification = classifyError(error);
    if (!classification.retryable) {
      await job.discard();
    }
    throw error;
  }
}

function createBulkOrchestratorProducers(
  connection: ConnectionOptions,
  container: WorkerContainer,
): BulkOrchestratorProducers & { close(): Promise<void> } {
  const refreshQueue = new Queue(QUEUE_NAMES.refreshCharacter, { connection });
  const recalculateQueue = new Queue(QUEUE_NAMES.recalculateScore, { connection });
  const bulkQueue = new Queue(QUEUE_NAMES.bulkCharacterProcessing, { connection });
  const PRIORITY_WEIGHT: Record<"high" | "normal" | "low", number> = {
    high: 10,
    normal: 0,
    low: -10,
  };

  return {
    async enqueueRefreshCharacter(input) {
      const payload = refreshCharacterJobSchema.parse({
        ...input,
        requestedAt: input.requestedAt ?? new Date().toISOString(),
      });
      const dedupeKey = refreshCharacterDedupeKey(payload);
      const result = await persistAndEnqueue({
        queue: refreshQueue,
        jobType: QUEUE_NAMES.refreshCharacter,
        dedupeKey,
        payload,
        jobRepository: container.repositories.job,
        logger: container.logger,
        options: {
          characterId: payload.characterId ?? null,
          priority: PRIORITY_WEIGHT[payload.priority],
        },
      });
      return {
        jobId: result.jobId,
        dedupeKey: result.dedupeKey,
        reused: result.reused,
        enqueued: result.enqueued,
      };
    },
    async enqueueRecalculateScore(input) {
      const payload = recalculateScoreJobSchema.parse({
        ...input,
        requestedAt: input.requestedAt ?? new Date().toISOString(),
      });
      const dedupeKey = recalculateScoreDedupeKey(payload);
      const result = await persistAndEnqueue({
        queue: recalculateQueue,
        jobType: QUEUE_NAMES.recalculateScore,
        dedupeKey,
        payload,
        jobRepository: container.repositories.job,
        logger: container.logger,
        options: { characterId: payload.characterId },
      });
      return {
        jobId: result.jobId,
        dedupeKey: result.dedupeKey,
        reused: result.reused,
        enqueued: result.enqueued,
      };
    },
    async enqueueBulkCharacterProcessing(input) {
      const payload = bulkOrchestratorJobSchema.parse({
        ...input,
        requestedAt: input.requestedAt ?? new Date().toISOString(),
      });
      const dedupeKey = bulkCharacterProcessingDedupeKey(payload);
      const result = await persistAndEnqueue({
        queue: bulkQueue,
        jobType: QUEUE_NAMES.bulkCharacterProcessing,
        dedupeKey,
        payload,
        jobRepository: container.repositories.job,
        logger: container.logger,
        options: { priority: PRIORITY_WEIGHT.low },
      });
      return {
        jobId: result.jobId,
        dedupeKey: result.dedupeKey,
        reused: result.reused,
        enqueued: result.enqueued,
      };
    },
    async close() {
      await Promise.all([refreshQueue.close(), recalculateQueue.close(), bulkQueue.close()]);
    },
  };
}

function createRefreshOnlyProducers(
  connection: ConnectionOptions,
  container: WorkerContainer,
): DiscoveryRefreshProducers & { close(): Promise<void> } {
  const queue = new Queue(QUEUE_NAMES.refreshCharacter, { connection });
  const PRIORITY_WEIGHT: Record<"high" | "normal" | "low", number> = {
    high: 10,
    normal: 0,
    low: -10,
  };
  return {
    async enqueueRefreshCharacter(input) {
      const payload = refreshCharacterJobSchema.parse({
        ...input,
        requestedAt: input.requestedAt ?? new Date().toISOString(),
      });
      const dedupeKey = refreshCharacterDedupeKey(payload);
      const result = await persistAndEnqueue({
        queue,
        jobType: QUEUE_NAMES.refreshCharacter,
        dedupeKey,
        payload,
        jobRepository: container.repositories.job,
        logger: container.logger,
        options: {
          characterId: payload.characterId ?? null,
          priority: PRIORITY_WEIGHT[payload.priority],
        },
      });
      return {
        jobId: result.jobId,
        dedupeKey: result.dedupeKey,
        reused: result.reused,
        enqueued: result.enqueued,
      };
    },
    async close() {
      await queue.close();
    },
  };
}

export function createWorkers(connection: ConnectionOptions, container: WorkerContainer): Worker[] {
  const refreshProducers = createRefreshOnlyProducers(connection, container);
  const bulkProducers = createBulkOrchestratorProducers(connection, container);

  const refresh = new Worker(
    QUEUE_NAMES.refreshCharacter,
    async (job) => {
      const payload = refreshCharacterJobSchema.parse(job.data);
      const result = await withRetryClassification(job, () => runRefreshPipeline(container, payload));
      return toBullmqReturnValue(result);
    },
    // Stage 3: keep effective refresh concurrency at 1 (BullMQ default).
    // Do not wire REFRESH_WORKER_CONCURRENCY until REFRESH_CONCURRENCY_ENABLED.
    { connection, autorun: false },
  );

  const analyze = new Worker(
    QUEUE_NAMES.analyzeRun,
    async (job) => {
      const payload = analyzeRunJobSchema.parse(job.data);
      const result = await withRetryClassification(job, () => runAnalyzeRun(container, payload));
      return toBullmqReturnValue(result);
    },
    { connection, autorun: false },
  );

  const recalculate = new Worker(
    QUEUE_NAMES.recalculateScore,
    async (job) => {
      const payload = recalculateScoreJobSchema.parse(job.data);
      const result = await withRetryClassification(job, () => runRecalculateScore(container, payload));
      return toBullmqReturnValue(result);
    },
    { connection, autorun: false },
  );

  const addonExport = new Worker(
    QUEUE_NAMES.generateAddonExport,
    async (job) => {
      const payload = generateAddonExportJobSchema.parse(job.data);
      const result = await withRetryClassification(job, () =>
        runGenerateAddonExport(container, payload),
      );
      return toBullmqReturnValue(result);
    },
    { connection, autorun: false },
  );

  const discover = new Worker(
    QUEUE_NAMES.discoverOwnedCharacters,
    async (job) => {
      const payload = discoverOwnedCharactersJobSchema.parse(job.data);
      const result = await withRetryClassification(job, () =>
        runDiscoverOwnedCharacters(container, payload, refreshProducers),
      );
      return toBullmqReturnValue(result);
    },
    { connection, autorun: false, concurrency: 1 },
  );

  const bulk = new Worker(
    QUEUE_NAMES.bulkCharacterProcessing,
    async (job) => {
      const payload = bulkOrchestratorJobSchema.parse(job.data);
      const result = await withRetryClassification(job, () =>
        runBulkCharacterProcessing(container, payload, bulkProducers),
      );
      return toBullmqReturnValue(result);
    },
    { connection, autorun: false, concurrency: 1 },
  );

  for (const worker of [refresh, analyze, recalculate, addonExport, discover, bulk]) {
    worker.on("failed", (job, error) => {
      container.logger.error({ jobId: job?.id, queue: worker.name, err: error }, "job failed");
    });
  }

  const originalDiscoverClose = discover.close.bind(discover);
  discover.close = async (force?: boolean) => {
    await refreshProducers.close();
    return originalDiscoverClose(force);
  };

  const originalBulkClose = bulk.close.bind(bulk);
  bulk.close = async (force?: boolean) => {
    await bulkProducers.close();
    return originalBulkClose(force);
  };

  return [refresh, analyze, recalculate, addonExport, discover, bulk];
}

/** Gracefully closes all workers; safe to call even if some workers never started running. */
export async function closeWorkers(workers: Worker[]): Promise<void> {
  await Promise.all(workers.map((worker) => worker.close()));
}
