import { Worker, type ConnectionOptions, type Job } from "bullmq";
import {
  QUEUE_NAMES,
  analyzeRunJobSchema,
  generateAddonExportJobSchema,
  recalculateScoreJobSchema,
  refreshCharacterJobSchema,
} from "@mplus/contracts";
import { toJsonSafeSanitized } from "@mplus/observability";
import type { WorkerContainer } from "./container.js";
import { runAnalyzeRun } from "./orchestration/analyze-run.js";
import { runGenerateAddonExport } from "./orchestration/generate-addon-export.js";
import { runRecalculateScore } from "./orchestration/recalculate-score.js";
import { runRefreshPipeline } from "./orchestration/refresh-pipeline.js";
import { classifyError } from "./orchestration/retry-classification.js";

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

export function createWorkers(connection: ConnectionOptions, container: WorkerContainer): Worker[] {
  const refresh = new Worker(
    QUEUE_NAMES.refreshCharacter,
    async (job) => {
      const payload = refreshCharacterJobSchema.parse(job.data);
      const result = await withRetryClassification(job, () => runRefreshPipeline(container, payload));
      return toBullmqReturnValue(result);
    },
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

  for (const worker of [refresh, analyze, recalculate, addonExport]) {
    worker.on("failed", (job, error) => {
      container.logger.error({ jobId: job?.id, queue: worker.name, err: error }, "job failed");
    });
  }

  return [refresh, analyze, recalculate, addonExport];
}

/** Gracefully closes all workers; safe to call even if some workers never started running. */
export async function closeWorkers(workers: Worker[]): Promise<void> {
  await Promise.all(workers.map((worker) => worker.close()));
}
