import type { Redis } from "ioredis";
import type { AppEnv } from "@mplus/config";
import { createLogger, type Logger } from "@mplus/observability";
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
import {
  analyzeRunDedupeKey,
  createQueueProducers,
  createWorkerContainer,
  generateAddonExportDedupeKey,
  negativeCache,
  recalculateScoreDedupeKey,
  refreshCharacterDedupeKey,
  runAnalyzeRun,
  runGenerateAddonExport,
  runRecalculateScore,
  runRefreshPipeline,
  type EnqueueResult,
  type NegativeCache,
  type QueueProducers,
  type WorkerContainer,
  type WorkerContainerOverrides,
} from "@mplus/worker";
import { ResponseCache } from "./lib/response-cache.js";

export interface ApiEntitlements {
  /** MVP flag: when true, serializers omit no fields for any client (all details public). */
  publicDetailsAll: boolean;
}

export interface ApiContainer {
  env: AppEnv;
  logger: Logger;
  worker: WorkerContainer;
  producers: QueueProducers;
  responseCache: ResponseCache;
  entitlements: ApiEntitlements;
  negativeCache: NegativeCache;
  close(): Promise<void>;
}

export interface ApiContainerOverrides {
  /** Forwarded to `createWorkerContainer` (prisma/providers/disabledProviders/repositories overrides). */
  workerOverrides?: WorkerContainerOverrides;
  /** Fully custom producers — tests can spy/fake without touching Redis at all. */
  producers?: QueueProducers;
  /**
   * When true (and `producers` is not set), refresh/analyze/recalculate/export "enqueue" calls run
   * the worker orchestration functions inline and synchronously instead of talking to BullMQ/Redis.
   * This lets Fastify `inject()` route tests exercise the full refresh pipeline without a running
   * worker process or Redis connection. Job rows still go through the same repositories, so
   * `GET /api/v1/jobs/:id` and dedupe/reuse behavior match production semantics.
   */
  skipQueues?: boolean;
  entitlements?: Partial<ApiEntitlements>;
  logger?: Logger;
}

/**
 * Synchronous stand-in for `createQueueProducers` used in tests (`skipQueues: true`). Persists the
 * same `IngestionJob` rows a real producer would, then runs the corresponding worker orchestration
 * function inline instead of publishing to BullMQ. Orchestration errors are logged and recorded on
 * the job row (never rethrown) so callers observe the same "enqueue never throws" contract as the
 * real producer.
 */
function createInlineQueueProducers(worker: WorkerContainer): QueueProducers {
  const { repositories, logger } = worker;

  return {
    async enqueueRefreshCharacter(input): Promise<EnqueueResult> {
      const payload = refreshCharacterJobSchema.parse({
        ...input,
        requestedAt: input.requestedAt ?? new Date().toISOString(),
      }) as RefreshCharacterJob;
      const dedupeKey = refreshCharacterDedupeKey(payload);
      const { job, reused } = await repositories.job.createOrGetByDedupe({
        jobType: QUEUE_NAMES.refreshCharacter,
        dedupeKey,
        characterId: payload.characterId ?? null,
        payload,
      });
      try {
        // runRefreshPipeline owns the full IngestionJob lifecycle (active/completed/failed) and
        // negative-cache bookkeeping for NOT_FOUND identities.
        await runRefreshPipeline(worker, payload);
      } catch (error) {
        logger.warn({ err: error, dedupeKey }, "inline refresh-character pipeline failed");
      }
      return { jobId: job.id, dedupeKey, reused };
    },

    async enqueueAnalyzeRun(input): Promise<EnqueueResult> {
      const payload: AnalyzeRunJob = analyzeRunJobSchema.parse({
        ...input,
        requestedAt: input.requestedAt ?? new Date().toISOString(),
      });
      const dedupeKey = analyzeRunDedupeKey(payload);
      const { job, reused } = await repositories.job.createOrGetByDedupe({
        jobType: QUEUE_NAMES.analyzeRun,
        dedupeKey,
        characterId: payload.characterId,
        runId: payload.runId,
        payload,
      });
      try {
        await repositories.job.markActive(job.id);
        await runAnalyzeRun(worker, payload);
        await repositories.job.markCompleted(job.id);
      } catch (error) {
        await repositories.job.markFailed(job.id, error);
        logger.warn({ err: error, dedupeKey }, "inline analyze-run failed");
      }
      return { jobId: job.id, dedupeKey, reused };
    },

    async enqueueRecalculateScore(input): Promise<EnqueueResult> {
      const payload: RecalculateScoreJob = recalculateScoreJobSchema.parse({
        ...input,
        requestedAt: input.requestedAt ?? new Date().toISOString(),
      });
      const dedupeKey = recalculateScoreDedupeKey(payload);
      const { job, reused } = await repositories.job.createOrGetByDedupe({
        jobType: QUEUE_NAMES.recalculateScore,
        dedupeKey,
        characterId: payload.characterId,
        payload,
      });
      try {
        await repositories.job.markActive(job.id);
        await runRecalculateScore(worker, payload);
        await repositories.job.markCompleted(job.id);
      } catch (error) {
        await repositories.job.markFailed(job.id, error);
        logger.warn({ err: error, dedupeKey }, "inline recalculate-score failed");
      }
      return { jobId: job.id, dedupeKey, reused };
    },

    async enqueueGenerateAddonExport(input): Promise<EnqueueResult> {
      const payload: GenerateAddonExportJob = generateAddonExportJobSchema.parse({
        ...input,
        requestedAt: input.requestedAt ?? new Date().toISOString(),
      });
      const dedupeKey = generateAddonExportDedupeKey(payload);
      const { job, reused } = await repositories.job.createOrGetByDedupe({
        jobType: QUEUE_NAMES.generateAddonExport,
        dedupeKey,
        payload,
      });
      try {
        await repositories.job.markActive(job.id);
        await runGenerateAddonExport(worker, payload);
        await repositories.job.markCompleted(job.id);
      } catch (error) {
        await repositories.job.markFailed(job.id, error);
        logger.warn({ err: error, dedupeKey }, "inline generate-addon-export failed");
      }
      return { jobId: job.id, dedupeKey, reused };
    },

    async close(): Promise<void> {
      // No Redis/BullMQ connection is ever opened in inline mode.
    },
  };
}

/**
 * Wires the API's dependency graph on top of the worker container: repositories/providers via
 * `createWorkerContainer`, BullMQ queue producers (or an inline synchronous fallback for tests),
 * an in-memory response cache, and MVP entitlement flags. Keeps Prisma/BullMQ out of route handlers.
 */
export function createApiContainer(env: AppEnv, overrides: ApiContainerOverrides = {}): ApiContainer {
  const logger = overrides.logger ?? createLogger({ level: env.LOG_LEVEL, name: "api" });
  const worker = createWorkerContainer(env, overrides.workerOverrides);

  let redisConnection: Redis | undefined;
  let producers: QueueProducers;
  let ownsProducers = false;

  if (overrides.producers) {
    producers = overrides.producers;
  } else if (overrides.skipQueues) {
    producers = createInlineQueueProducers(worker);
  } else {
    redisConnection = worker.createRedisConnection();
    producers = createQueueProducers(redisConnection, worker);
    ownsProducers = true;
  }

  return {
    env,
    logger,
    worker,
    producers,
    responseCache: new ResponseCache(),
    entitlements: {
      publicDetailsAll: overrides.entitlements?.publicDetailsAll ?? env.PUBLIC_DETAILS_ALL,
    },
    negativeCache,
    async close(): Promise<void> {
      if (ownsProducers) {
        await producers.close();
      }
      if (redisConnection) {
        await redisConnection.quit();
      }
      await worker.prisma.$disconnect();
    },
  };
}
