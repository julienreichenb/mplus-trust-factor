import { Worker, type ConnectionOptions, type Processor } from "bullmq";
import {
  QUEUE_NAMES,
  analyzeRunJobSchema,
  generateAddonExportJobSchema,
  recalculateScoreJobSchema,
  refreshCharacterJobSchema,
} from "@mplus/contracts";
import type { Logger } from "@mplus/observability";

export class NotImplementedJobError extends Error {
  constructor(queue: string) {
    super(`Processor for queue "${queue}" is not implemented (development skeleton)`);
    this.name = "NotImplementedJobError";
  }
}

function notImplementedProcessor(queue: string, logger: Logger): Processor {
  return async (job) => {
    logger.warn({ queue, jobId: job.id }, "NotImplemented processor invoked");
    if (process.env.NODE_ENV === "production") {
      throw new NotImplementedJobError(queue);
    }
    throw new NotImplementedJobError(queue);
  };
}

export function createWorkers(connection: ConnectionOptions, logger: Logger): Worker[] {
  const refresh = new Worker(
    QUEUE_NAMES.refreshCharacter,
    async (job) => {
      refreshCharacterJobSchema.parse(job.data);
      return notImplementedProcessor(QUEUE_NAMES.refreshCharacter, logger)(job);
    },
    { connection, autorun: false },
  );

  const analyze = new Worker(
    QUEUE_NAMES.analyzeRun,
    async (job) => {
      analyzeRunJobSchema.parse(job.data);
      return notImplementedProcessor(QUEUE_NAMES.analyzeRun, logger)(job);
    },
    { connection, autorun: false },
  );

  const recalculate = new Worker(
    QUEUE_NAMES.recalculateScore,
    async (job) => {
      recalculateScoreJobSchema.parse(job.data);
      return notImplementedProcessor(QUEUE_NAMES.recalculateScore, logger)(job);
    },
    { connection, autorun: false },
  );

  const addonExport = new Worker(
    QUEUE_NAMES.generateAddonExport,
    async (job) => {
      generateAddonExportJobSchema.parse(job.data);
      return notImplementedProcessor(QUEUE_NAMES.generateAddonExport, logger)(job);
    },
    { connection, autorun: false },
  );

  return [refresh, analyze, recalculate, addonExport];
}
