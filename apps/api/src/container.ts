import type { Redis } from "ioredis";
import type { AppEnv } from "@mplus/config";
import { createLogger, type Logger } from "@mplus/observability";
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
import {
  analyzeRunDedupeKey,
  bulkCharacterProcessingDedupeKey,
  createQueueProducers,
  createWorkerContainer,
  discoverOwnedCharactersDedupeKey,
  generateAddonExportDedupeKey,
  negativeCache,
  recalculateScoreDedupeKey,
  refreshCharacterDedupeKey,
  runAnalyzeRun,
  runBulkCharacterProcessing,
  runDiscoverOwnedCharacters,
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
import { createBattleNetOAuthClient, type BattleNetOAuthClient } from "./iam/battlenet-oauth-client.js";
import { IamAuthService } from "./iam/auth-service.js";

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
  /** Whether BullMQ/Redis is required for readiness (false when skipQueues/inline). */
  queueMode: "bullmq" | "inline";
  /**
   * Shared Redis connection when queueMode is bullmq; null in inline/skipQueues tests.
   * Used for read-only refresh ETA / admission scheduling state (never for provider calls).
   */
  getAdmissionRedis(): Redis | null;
  oauthClient: BattleNetOAuthClient;
  authService: IamAuthService;
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
  oauthClient?: BattleNetOAuthClient;
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

  const inlineProducers: QueueProducers = {
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
        // Safety net: a job with an error must never remain QUEUED/ACTIVE for refresh polling.
        const current = await repositories.job.findById(job.id);
        if (current && (current.status === "QUEUED" || current.status === "ACTIVE")) {
          await repositories.job.markFailed(job.id, error);
        }
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

    async enqueueDiscoverOwnedCharacters(input): Promise<EnqueueResult> {
      const payload: DiscoverOwnedCharactersJob = discoverOwnedCharactersJobSchema.parse({
        ...input,
        requestedAt: input.requestedAt ?? new Date().toISOString(),
      });
      const dedupeKey = discoverOwnedCharactersDedupeKey(payload);
      const { job, reused } = await repositories.job.createOrGetByDedupe({
        jobType: QUEUE_NAMES.discoverOwnedCharacters,
        dedupeKey,
        payload,
      });
      await worker.prisma.battleNetAccount.updateMany({
        where: { id: payload.battleNetAccountId },
        data: {
          lastDiscoveryJobId: job.id,
          ...(reused ? {} : { lastDiscoveryStatus: "QUEUED" }),
        },
      });
      if (reused) {
        return { jobId: job.id, dedupeKey, reused, enqueued: false };
      }
      try {
        await repositories.job.markActive(job.id);
        await runDiscoverOwnedCharacters(worker, payload, inlineProducers);
        await repositories.job.markCompleted(job.id);
      } catch (error) {
        await repositories.job.markFailed(job.id, error);
        logger.warn({ err: error, dedupeKey }, "inline discover-owned-characters failed");
      }
      return { jobId: job.id, dedupeKey, reused, enqueued: true };
    },

    async enqueueBulkCharacterProcessing(input): Promise<EnqueueResult> {
      const payload: BulkOrchestratorJob = bulkOrchestratorJobSchema.parse({
        ...input,
        requestedAt: input.requestedAt ?? new Date().toISOString(),
      });
      const dedupeKey = bulkCharacterProcessingDedupeKey(payload);
      const { job, reused } = await repositories.job.createOrGetByDedupe({
        jobType: QUEUE_NAMES.bulkCharacterProcessing,
        dedupeKey,
        payload,
      });
      if (reused) {
        return { jobId: job.id, dedupeKey, reused, enqueued: false };
      }
      // Match BullMQ: accept the job and return immediately. Inline execution must not
      // block admin activation (RECALCULATE_ONLY over the full character table).
      void (async () => {
        try {
          await repositories.job.markActive(job.id);
          await runBulkCharacterProcessing(worker, payload, inlineProducers);
          await repositories.job.markCompleted(job.id);
        } catch (error) {
          try {
            await repositories.job.markFailed(job.id, error);
          } catch {
            // Prisma may already be disconnected when the suite tears down.
          }
          logger.warn({ err: error, dedupeKey }, "inline bulk-character-processing failed");
        }
      })();
      return { jobId: job.id, dedupeKey, reused, enqueued: true };
    },

    getRefreshCharacterQueue() {
      return null;
    },

    async close(): Promise<void> {
      // No Redis/BullMQ connection is ever opened in inline mode.
    },
  };

  return inlineProducers;
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
  let queueMode: "bullmq" | "inline" = "bullmq";

  if (overrides.producers) {
    producers = overrides.producers;
    queueMode = "inline";
  } else if (overrides.skipQueues) {
    producers = createInlineQueueProducers(worker);
    queueMode = "inline";
  } else {
    redisConnection = worker.createRedisConnection();
    producers = createQueueProducers(redisConnection, worker);
    ownsProducers = true;
    queueMode = "bullmq";
  }

  const oauthClient = overrides.oauthClient ?? createBattleNetOAuthClient(env);
  const authService = new IamAuthService(worker.prisma, env, oauthClient, {
    enqueueOwnedCharacterDiscovery: async (input) => {
      // seasonKey is a soft hint only; discovery resolves authoritative season per region.
      const season = await worker.prisma.season.findFirst({
        where: { isCurrent: true },
        orderBy: { updatedAt: "desc" },
      });
      const discovery = await producers.enqueueDiscoverOwnedCharacters({
        battleNetAccountId: input.battleNetAccountId,
        userId: input.userId,
        ownershipSyncAt: input.ownershipSyncAt,
        seasonKey: season?.slug ?? "current",
        correlationId: null,
      });
      worker.logger.info(
        {
          triggerSource: "BATTLE_NET_LINK_OR_REFRESH_OWNERSHIP",
          battleNetAccountId: input.battleNetAccountId,
          discovery: discovery.reused && !discovery.enqueued ? "reused" : "enqueued",
          jobId: discovery.jobId,
        },
        "ownership_discovery_enqueue",
      );
      return discovery;
    },
  });

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
    queueMode,
    getAdmissionRedis: () => redisConnection ?? null,
    oauthClient,
    authService,
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
