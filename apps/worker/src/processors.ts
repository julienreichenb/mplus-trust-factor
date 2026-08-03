import { Queue, Worker, type ConnectionOptions, type Job } from "bullmq";
import {
  QUEUE_NAMES,
  analyzeEvidenceSlotJobV2Schema,
  analyzeRunJobSchema,
  bulkOrchestratorJobSchema,
  calibrationRunJobSchema,
  scoringV2EvidenceExportJobSchema,
  discoverOwnedCharactersJobSchema,
  finalizeEvidenceBatchJobV2Schema,
  generateAddonExportJobSchema,
  recalculateScoreJobSchema,
  refreshCharacterJobSchema,
} from "@mplus/contracts";
import { toJsonSafeSanitized } from "@mplus/observability";
import type { WorkerContainer } from "./container.js";
import {
  bulkCharacterProcessingDedupeKey,
  finalizeEvidenceBatchV2DedupeKey,
  recalculateScoreDedupeKey,
  refreshCharacterDedupeKey,
} from "./dedupe.js";
import { persistAndEnqueue } from "./orchestration/enqueue.js";
import { runAnalyzeRun } from "./orchestration/analyze-run.js";
import { runBulkCharacterProcessing } from "./orchestration/bulk-character-processing.js";
import { runCalibrationRunJob } from "./orchestration/calibration-run.js";
import { runScoringV2EvidenceExportJob } from "./orchestration/scoring-v2-evidence-export.js";
import { runDiscoverOwnedCharacters } from "./orchestration/discover-owned-characters.js";
import { runGenerateAddonExport } from "./orchestration/generate-addon-export.js";
import { runRecalculateScore } from "./orchestration/recalculate-score.js";
import { runRefreshPipeline } from "./orchestration/refresh-pipeline.js";
import { classifyError } from "./orchestration/retry-classification.js";
import {
  runAnalyzeEvidenceSlotV2,
  runFinalizeEvidenceBatchV2,
} from "./orchestration/scoring-v2/index.js";
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
    // Dual-lane refresh: BullMQ claim concurrency is capped at REFRESH_LANE_WORKER_CLAIM_HARD_MAX.
    // RuntimeSetting + Redis lane permits enforce concurrency_operation / concurrency_calibration.
    // Do not wire REFRESH_WORKER_CONCURRENCY env until REFRESH_CONCURRENCY_ENABLED.
    { connection, autorun: false, concurrency: 8 },
  );

  const refreshCalibration = new Worker(
    QUEUE_NAMES.refreshCharacterCalibration,
    async (job) => {
      const payload = refreshCharacterJobSchema.parse({
        ...job.data,
        workloadClass: "CALIBRATION",
      });
      const result = await withRetryClassification(job, () => runRefreshPipeline(container, payload));
      return toBullmqReturnValue(result);
    },
    { connection, autorun: false, concurrency: 8 },
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

  // Dedicated calibration-run worker. Deliberately constructed with only prisma/logger/flag —
  // never given access to producers or Blizzard/WCL/RaiderIO providers — so calibration jobs
  // cannot enqueue refresh work or call external providers.
  const calibration = new Worker(
    QUEUE_NAMES.calibrationRun,
    async (job) => {
      const payload = calibrationRunJobSchema.parse(job.data);
      const result = await withRetryClassification(job, () =>
        runCalibrationRunJob(
          {
            prisma: container.prisma,
            logger: container.logger,
            calibrationEnabled: container.env.ADMIN_CALIBRATION_ENABLED,
          },
          payload,
        ),
      );
      return toBullmqReturnValue(result);
    },
    { connection, autorun: false, concurrency: 1 },
  );

  // Provider-free evidence export — no producers / no Blizzard/WCL/RaiderIO.
  const evidenceExport = new Worker(
    QUEUE_NAMES.scoringV2EvidenceExport,
    async (job) => {
      const payload = scoringV2EvidenceExportJobSchema.parse(job.data);
      const result = await withRetryClassification(job, () =>
        runScoringV2EvidenceExportJob(
          {
            prisma: container.prisma,
            logger: container.logger,
            artifacts: container.repositories.artifacts,
            scoreTtlSeconds: container.env.SCORE_TTL_SECONDS,
          },
          payload,
        ),
      );
      return toBullmqReturnValue(result);
    },
    { connection, autorun: false, concurrency: 1 },
  );

  // Scoring V2 slot fan-out — bounded concurrency independent of job count.
  // Per-character fairness is enforced via batch generation + claim CAS, not unbounded WCL.
  const evidenceSlotFinalizeQueue = new Queue(QUEUE_NAMES.finalizeAnalysisBatch, { connection });
  const evidenceSlot = new Worker(
    QUEUE_NAMES.analyzeEvidenceSlot,
    async (job) => {
      const payload = analyzeEvidenceSlotJobV2Schema.parse(job.data);
      const result = await withRetryClassification(job, () =>
        runAnalyzeEvidenceSlotV2(container, payload, {
          async enqueueFinalizeEvidenceBatch(input) {
            const finalizePayload = finalizeEvidenceBatchJobV2Schema.parse({
              ...input,
              schemaVersion: "2.0.0",
              requestedAt: input.requestedAt ?? new Date().toISOString(),
            });
            const dedupeKey = finalizeEvidenceBatchV2DedupeKey(finalizePayload);
            const enqueued = await persistAndEnqueue({
              queue: evidenceSlotFinalizeQueue,
              jobType: QUEUE_NAMES.finalizeAnalysisBatch,
              dedupeKey,
              payload: finalizePayload,
              jobRepository: container.repositories.job,
              logger: container.logger,
            });
            return { jobId: enqueued.jobId };
          },
        }),
      );
      return toBullmqReturnValue(result);
    },
    // Bound WCL concurrency: keep low regardless of how many slot jobs are queued.
    { connection, autorun: false, concurrency: 2 },
  );

  // Scoring V2 fan-in — provider-free (no producers / no WCL). Calibration stays isolated.
  const evidenceFinalize = new Worker(
    QUEUE_NAMES.finalizeAnalysisBatch,
    async (job) => {
      const payload = finalizeEvidenceBatchJobV2Schema.parse(job.data);
      const result = await withRetryClassification(job, () =>
        runFinalizeEvidenceBatchV2(container, payload),
      );
      return toBullmqReturnValue(result);
    },
    { connection, autorun: false, concurrency: 1 },
  );

  for (const worker of [
    refresh,
    refreshCalibration,
    analyze,
    recalculate,
    addonExport,
    discover,
    bulk,
    calibration,
    evidenceExport,
    evidenceSlot,
    evidenceFinalize,
  ]) {
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

  const originalEvidenceSlotClose = evidenceSlot.close.bind(evidenceSlot);
  evidenceSlot.close = async (force?: boolean) => {
    await evidenceSlotFinalizeQueue.close();
    return originalEvidenceSlotClose(force);
  };

  return [
    refresh,
    refreshCalibration,
    analyze,
    recalculate,
    addonExport,
    discover,
    bulk,
    calibration,
    evidenceExport,
    evidenceSlot,
    evidenceFinalize,
  ];
}

/** Gracefully closes all workers; safe to call even if some workers never started running. */
export async function closeWorkers(workers: Worker[]): Promise<void> {
  await Promise.all(workers.map((worker) => worker.close()));
}
