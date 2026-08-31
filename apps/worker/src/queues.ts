import { Queue, type ConnectionOptions } from "bullmq";
import {
  QUEUE_NAMES,
  KEY_CONTEXT_REGION_CODES,
  analyzeEvidenceSlotJobV2Schema,
  analyzeRunJobSchema,
  bulkOrchestratorJobSchema,
  calibrationRunJobSchema,
  ScoringEvidenceExportJobSchema,
  discoverOwnedCharactersJobSchema,
  finalizeEvidenceBatchJobV2Schema,
  generateAddonExportJobSchema,
  recalculateScoreJobSchema,
  refreshCharacterJobSchema,
  type AnalyzeEvidenceSlotJobV2,
  type AnalyzeRunJob,
  type BulkOrchestratorJob,
  type CalibrationRunJob,
  type ScoringEvidenceExportJob,
  type DiscoverOwnedCharactersJob,
  type FinalizeEvidenceBatchJobV2,
  keyDistributionRefreshJobSchema,
  scoringSeasonDataSyncJobSchema,
  relevantCharacterDiscoveryJobSchema,
  providerDataExportJobSchema,
  providerDataImportJobSchema,
  type KeyDistributionRefreshJob,
  type RelevantCharacterDiscoveryJob,
  type GenerateAddonExportJob,
  type RecalculateScoreJob,
  type RefreshCharacterJob,
} from "@mplus/contracts";
import type { WorkerContainer } from "./container.js";
import {
  analyzeEvidenceSlotV2DedupeKey,
  analyzeRunDedupeKey,
  bulkCharacterProcessingDedupeKey,
  discoverOwnedCharactersDedupeKey,
  relevantCharacterDiscoveryDedupeKey,
  finalizeEvidenceBatchV2DedupeKey,
  generateAddonExportDedupeKey,
  recalculateScoreDedupeKey,
  refreshCharacterDedupeKey,
} from "./dedupe.js";
import { persistAndEnqueue } from "./orchestration/enqueue.js";
import { runDiscoverOwnedCharacters } from "./orchestration/discover-owned-characters.js";
import {
  PROVIDER_DATA_EXPORT_SCHEDULER_ID,
  PROVIDER_DATA_IMPORT_SCHEDULER_ID,
  SCORING_SEASON_DATA_SYNC_SCHEDULER_ID,
  providerDataExportRepeatOpts,
  providerDataImportRepeatOpts,
  scoringSeasonDataSyncRepeatOpts,
  shouldRegisterAutomaticBackgroundSchedulers,
  shouldRegisterExpensiveProviderPopulationSchedulers,
  shouldRegisterProviderDataExportSchedule,
  shouldRegisterProviderDataImportSchedule,
} from "./scheduling/automatic-schedulers.js";

export interface EnqueueResult {
  jobId: string;
  dedupeKey: string;
  /** True when an existing non-terminal IngestionJob row was reused instead of created. */
  reused: boolean;
  /** True when a new BullMQ message was published for this call. */
  enqueued?: boolean;
  /**
   * True when an in-flight job was reused and the requester's workloadClass differs
   * from the persisted lane (original job keeps its queue/payload/DB class).
   */
  reusedAcrossWorkloadIntent?: boolean;
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
  /**
   * Dedicated calibration-run queue — NOT an IngestionJob / refresh-character job.
   * Deduped by CalibrationRun UUID (jobId = calibrationRunId); never affects refresh
   * admission, concurrency, ETA, throughput, or priority.
   */
  enqueueCalibrationRun(
    input: { calibrationRunId: string; requestedAt?: string; correlationId?: string | null },
  ): Promise<EnqueueResult>;
  /** Admin Scoring V2 evidence export — provider-free, not an IngestionJob. */
  enqueueScoringEvidenceExport(
    input: { exportId: string; requestedAt?: string; correlationId?: string | null },
  ): Promise<EnqueueResult>;
  /** Admin Shadow Canary — async single-character SHADOW run. */
  enqueueScoringShadowCanary(
    input: {
      canaryId: string;
      region: "EU" | "US" | "KR" | "TW";
      realmSlug: string;
      characterName: string;
      requestedAt?: string;
      correlationId?: string | null;
    },
  ): Promise<EnqueueResult>;
  /** Scoring V2 — one job per acquisition-plan slot (provider-aware). */
  enqueueAnalyzeEvidenceSlot(
    input: Omit<AnalyzeEvidenceSlotJobV2, "requestedAt" | "schemaVersion"> & {
      requestedAt?: string;
    },
  ): Promise<EnqueueResult>;
  /** Scoring V2 — fan-in finalization (provider-free). */
  enqueueFinalizeEvidenceBatch(
    input: Omit<FinalizeEvidenceBatchJobV2, "requestedAt" | "schemaVersion"> & {
      requestedAt?: string;
    },
  ): Promise<EnqueueResult>;
  enqueueKeyDistributionRefresh(
    input: Omit<KeyDistributionRefreshJob, "requestedAt"> & { requestedAt?: string },
  ): Promise<EnqueueResult>;
  enqueueScoringSeasonDataSync(input: {
    trigger?: "schedule" | "admin" | "startup";
    blizzardSeasonId?: number;
    requestedAt?: string;
  }): Promise<EnqueueResult>;
  /** Manual / admin enqueue — available in every APP_ENV (not gated). */
  enqueueRelevantCharacterDiscovery(
    input: Omit<RelevantCharacterDiscoveryJob, "requestedAt"> & { requestedAt?: string },
  ): Promise<EnqueueResult>;
  /**
   * Registers recurring scoring-season sync when APP_ENV is staging/production.
   * Returns whether a scheduler was registered.
   */
  registerScoringSeasonDataSyncSchedule(): Promise<{ registered: boolean }>;
  /**
   * Registers relevant discovery + drain feed when deployed AND PROVIDER_DATA_ROLE=collector.
   */
  registerRelevantCharacterDiscoverySchedule(): Promise<{ registered: boolean }>;
  /** Collector nightly portable corpus export. */
  registerProviderDataExportSchedule(): Promise<{ registered: boolean }>;
  /** Consumer nightly portable corpus import. */
  registerProviderDataImportSchedule(): Promise<{ registered: boolean }>;
  /** Refresh-character queue for admin cancel/prioritize/kill-all. Null in inline mode. */
  getRefreshCharacterQueue(): Queue | null;
  /** Calibration-run queue for admin cancel (QUEUED jobs). Null in inline mode. */
  getCalibrationRunQueue(): Queue | null;
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
    [QUEUE_NAMES.refreshCharacterCalibration]: new Queue(QUEUE_NAMES.refreshCharacterCalibration, {
      connection,
    }),
    [QUEUE_NAMES.analyzeRun]: new Queue(QUEUE_NAMES.analyzeRun, { connection }),
    [QUEUE_NAMES.recalculateScore]: new Queue(QUEUE_NAMES.recalculateScore, { connection }),
    [QUEUE_NAMES.generateAddonExport]: new Queue(QUEUE_NAMES.generateAddonExport, { connection }),
    [QUEUE_NAMES.discoverOwnedCharacters]: new Queue(QUEUE_NAMES.discoverOwnedCharacters, {
      connection,
    }),
    [QUEUE_NAMES.bulkCharacterProcessing]: new Queue(QUEUE_NAMES.bulkCharacterProcessing, {
      connection,
    }),
    [QUEUE_NAMES.calibrationRun]: new Queue(QUEUE_NAMES.calibrationRun, { connection }),
    [QUEUE_NAMES.ScoringEvidenceExport]: new Queue(QUEUE_NAMES.ScoringEvidenceExport, {
      connection,
    }),
    [QUEUE_NAMES.ScoringShadowCanary]: new Queue(QUEUE_NAMES.ScoringShadowCanary, {
      connection,
    }),
    [QUEUE_NAMES.analyzeEvidenceSlot]: new Queue(QUEUE_NAMES.analyzeEvidenceSlot, { connection }),
    [QUEUE_NAMES.finalizeAnalysisBatch]: new Queue(QUEUE_NAMES.finalizeAnalysisBatch, {
      connection,
    }),
    [QUEUE_NAMES.keyDistributionRefresh]: new Queue(QUEUE_NAMES.keyDistributionRefresh, {
      connection,
    }),
    [QUEUE_NAMES.scoringSeasonDataSync]: new Queue(QUEUE_NAMES.scoringSeasonDataSync, {
      connection,
    }),
    [QUEUE_NAMES.relevantCharacterDiscovery]: new Queue(QUEUE_NAMES.relevantCharacterDiscovery, {
      connection,
    }),
    [QUEUE_NAMES.providerDataExport]: new Queue(QUEUE_NAMES.providerDataExport, { connection }),
    [QUEUE_NAMES.providerDataImport]: new Queue(QUEUE_NAMES.providerDataImport, { connection }),
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
      const requestedWorkloadClass = input.workloadClass ?? "OPERATION";
      const payload = refreshCharacterJobSchema.parse({
        ...input,
        workloadClass: requestedWorkloadClass,
        requestedAt: input.requestedAt ?? new Date().toISOString(),
      }) as RefreshCharacterJob;
      const dedupeKey = refreshCharacterDedupeKey(payload);
      const queue =
        requestedWorkloadClass === "CALIBRATION"
          ? queues[QUEUE_NAMES.refreshCharacterCalibration]
          : queues[QUEUE_NAMES.refreshCharacter];
      const result = await enqueue(queue, queue.name, dedupeKey, payload, {
        characterId: payload.characterId ?? null,
        priority: PRIORITY_WEIGHT[payload.priority],
      });

      // Authoritative lane = IngestionJob.workloadClass at creation / successful enqueue.
      // Never migrate DB (or BullMQ payload/queue) on incidental in-flight reuse.
      if (result.enqueued) {
        await container.prisma.ingestionJob.updateMany({
          where: { id: result.jobId },
          data: { workloadClass: requestedWorkloadClass },
        });
        return { ...result, reusedAcrossWorkloadIntent: false };
      }

      const existing = await container.prisma.ingestionJob.findUnique({
        where: { id: result.jobId },
        select: { workloadClass: true },
      });
      const existingWorkloadClass = existing?.workloadClass ?? "OPERATION";
      const reusedAcrossWorkloadIntent = existingWorkloadClass !== requestedWorkloadClass;
      if (reusedAcrossWorkloadIntent) {
        container.logger.info(
          {
            jobId: result.jobId,
            dedupeKey,
            requestedWorkloadClass,
            existingWorkloadClass,
          },
          "refresh job reused across workload intent",
        );
      }
      return { ...result, reusedAcrossWorkloadIntent };
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

    async enqueueCalibrationRun(input) {
      const payload: CalibrationRunJob = calibrationRunJobSchema.parse({
        calibrationRunId: input.calibrationRunId,
        requestedAt: input.requestedAt ?? new Date().toISOString(),
        correlationId: input.correlationId ?? null,
      });
      // Deliberately bypasses persistAndEnqueue/IngestionJob — dedicated queue, deduped by
      // CalibrationRun UUID as the BullMQ jobId (no dedupeKey/IngestionJob row involved).
      const job = await queues[QUEUE_NAMES.calibrationRun].add(
        QUEUE_NAMES.calibrationRun,
        payload,
        { jobId: payload.calibrationRunId },
      );
      return {
        jobId: job.id ?? payload.calibrationRunId,
        dedupeKey: payload.calibrationRunId,
        reused: false,
        enqueued: true,
      };
    },

    async enqueueScoringEvidenceExport(input) {
      const payload: ScoringEvidenceExportJob = ScoringEvidenceExportJobSchema.parse({
        exportId: input.exportId,
        requestedAt: input.requestedAt ?? new Date().toISOString(),
        correlationId: input.correlationId ?? null,
      });
      const job = await queues[QUEUE_NAMES.ScoringEvidenceExport].add(
        QUEUE_NAMES.ScoringEvidenceExport,
        payload,
        { jobId: payload.exportId },
      );
      return {
        jobId: job.id ?? payload.exportId,
        dedupeKey: payload.exportId,
        reused: false,
        enqueued: true,
      };
    },

    async enqueueScoringShadowCanary(input) {
      const payload = {
        canaryId: input.canaryId,
        region: input.region,
        realmSlug: input.realmSlug,
        characterName: input.characterName,
        requestedAt: input.requestedAt ?? new Date().toISOString(),
        correlationId: input.correlationId ?? null,
        forceRefresh: false,
      };
      const job = await queues[QUEUE_NAMES.ScoringShadowCanary].add(
        QUEUE_NAMES.ScoringShadowCanary,
        payload,
        { jobId: input.canaryId },
      );
      return {
        jobId: job.id ?? input.canaryId,
        dedupeKey: input.canaryId,
        reused: false,
        enqueued: true,
      };
    },

    async enqueueAnalyzeEvidenceSlot(input) {
      const payload = analyzeEvidenceSlotJobV2Schema.parse({
        ...input,
        schemaVersion: "2.0.0",
        requestedAt: input.requestedAt ?? new Date().toISOString(),
      });
      const dedupeKey = analyzeEvidenceSlotV2DedupeKey(payload);
      const result = await persistAndEnqueue({
        queue: queues[QUEUE_NAMES.analyzeEvidenceSlot],
        jobType: QUEUE_NAMES.analyzeEvidenceSlot,
        dedupeKey,
        payload,
        jobRepository: container.repositories.job,
        logger: container.logger,
        options: {
          // Permit/budget deferral releases RUNNING→PENDING; BullMQ must retry.
          attempts: 12,
          backoff: { type: "fixed", delay: 5_000 },
        },
      });
      return {
        jobId: result.jobId,
        dedupeKey: result.dedupeKey,
        reused: result.reused,
        enqueued: result.enqueued,
      };
    },


    async enqueueFinalizeEvidenceBatch(input) {
      const payload = finalizeEvidenceBatchJobV2Schema.parse({
        ...input,
        schemaVersion: "2.0.0",
        requestedAt: input.requestedAt ?? new Date().toISOString(),
      });
      const dedupeKey = finalizeEvidenceBatchV2DedupeKey(payload);
      return enqueue(
        queues[QUEUE_NAMES.finalizeAnalysisBatch],
        QUEUE_NAMES.finalizeAnalysisBatch,
        dedupeKey,
        payload,
      );
    },

    async enqueueKeyDistributionRefresh(input) {
      const payload = keyDistributionRefreshJobSchema.parse({
        ...input,
        requestedAt: input.requestedAt ?? new Date().toISOString(),
      });
      const job = await queues[QUEUE_NAMES.keyDistributionRefresh].add(
        QUEUE_NAMES.keyDistributionRefresh,
        payload,
        { jobId: payload.refreshId },
      );
      return {
        jobId: job.id ?? payload.refreshId,
        dedupeKey: payload.refreshId,
        reused: false,
        enqueued: true,
      };
    },

    async enqueueScoringSeasonDataSync(input) {
      const payload = scoringSeasonDataSyncJobSchema.parse({
        trigger: input.trigger ?? "admin",
        blizzardSeasonId: input.blizzardSeasonId,
        requestedAt: input.requestedAt ?? new Date().toISOString(),
      });
      const job = await queues[QUEUE_NAMES.scoringSeasonDataSync].add(
        QUEUE_NAMES.scoringSeasonDataSync,
        payload,
      );
      return {
        jobId: job.id ?? `scoring-season-data-sync-${payload.requestedAt}`,
        dedupeKey: `scoring-season-data-sync:${payload.trigger}:${payload.blizzardSeasonId ?? "effective"}`,
        reused: false,
        enqueued: true,
      };
    },

    async enqueueRelevantCharacterDiscovery(input) {
      const payload = relevantCharacterDiscoveryJobSchema.parse({
        ...input,
        requestedAt: input.requestedAt ?? new Date().toISOString(),
      });
      const dedupeKey = relevantCharacterDiscoveryDedupeKey(payload);
      const job = await queues[QUEUE_NAMES.relevantCharacterDiscovery].add(
        QUEUE_NAMES.relevantCharacterDiscovery,
        payload,
        { jobId: `${dedupeKey}:${payload.requestedAt}` },
      );
      return {
        jobId: job.id ?? dedupeKey,
        dedupeKey,
        reused: false,
        enqueued: true,
      };
    },

    async registerScoringSeasonDataSyncSchedule() {
      const queue = queues[QUEUE_NAMES.scoringSeasonDataSync];
      if (!shouldRegisterAutomaticBackgroundSchedulers(container.env.APP_ENV)) {
        await queue.removeJobScheduler(SCORING_SEASON_DATA_SYNC_SCHEDULER_ID).catch(() => undefined);
        container.logger.info(
          {
            event: "scoring_season_data_sync_schedule_skipped",
            appEnv: container.env.APP_ENV,
            reason: "automatic_schedulers_disabled_for_app_env",
          },
          "scoring season data sync schedule not registered for this APP_ENV",
        );
        return { registered: false };
      }
      await queue.upsertJobScheduler(
        SCORING_SEASON_DATA_SYNC_SCHEDULER_ID,
        scoringSeasonDataSyncRepeatOpts(),
        {
          name: QUEUE_NAMES.scoringSeasonDataSync,
          data: {
            trigger: "schedule",
            requestedAt: new Date().toISOString(),
          },
        },
      );
      return { registered: true };
    },

    async registerRelevantCharacterDiscoverySchedule() {
      const queue = queues[QUEUE_NAMES.relevantCharacterDiscovery];
      const addonRegionSet = new Set<string>(KEY_CONTEXT_REGION_CODES);
      const regions = await container.prisma.region.findMany({
        where: { enabled: true },
        select: { code: true },
        orderBy: { code: "asc" },
      });
      const targets = regions.filter((r) => addonRegionSet.has(r.code));

      const removeRegionSchedulers = async () => {
        await queue.removeJobScheduler("daily-relevant-character-discovery-eu").catch(() => undefined);
        await queue.removeJobScheduler("relevant-drain-feed").catch(() => undefined);
        for (const code of KEY_CONTEXT_REGION_CODES) {
          const regionKey = code.toLowerCase();
          await queue
            .removeJobScheduler(`daily-relevant-character-discovery-${regionKey}`)
            .catch(() => undefined);
          await queue.removeJobScheduler(`relevant-drain-feed-${regionKey}`).catch(() => undefined);
        }
      };

      if (
        !shouldRegisterExpensiveProviderPopulationSchedulers(
          container.env.APP_ENV,
          container.env.PROVIDER_DATA_ROLE,
        )
      ) {
        await removeRegionSchedulers();
        container.logger.info(
          {
            event: "relevant_discovery_schedule_skipped",
            appEnv: container.env.APP_ENV,
            providerDataRole: container.env.PROVIDER_DATA_ROLE,
            reason: "expensive_provider_population_disabled",
          },
          "relevant character discovery schedule not registered for this APP_ENV/role",
        );
        return { registered: false };
      }

      // Always clear region schedulers first so disabled regions and empty target
      // sets cannot leave stale discovery/drain jobs registered in Redis.
      await removeRegionSchedulers();

      if (targets.length === 0) {
        container.logger.warn(
          { event: "relevant_discovery_schedule_skipped", reason: "no_enabled_addon_regions" },
          "relevant character discovery schedule skipped — no enabled addon regions",
        );
        return { registered: false };
      }

      for (const { code } of targets) {
        const regionKey = code.toLowerCase();
        await queue.upsertJobScheduler(
          `daily-relevant-character-discovery-${regionKey}`,
          { every: 24 * 60 * 60 * 1000 },
          {
            name: QUEUE_NAMES.relevantCharacterDiscovery,
            data: {
              mode: "daily_discovery",
              regionCode: code,
              requestedAt: new Date().toISOString(),
            },
          },
        );
        await queue.upsertJobScheduler(
          `relevant-drain-feed-${regionKey}`,
          { every: 5 * 60 * 1000 },
          {
            name: QUEUE_NAMES.relevantCharacterDiscovery,
            data: {
              mode: "drain_feed",
              regionCode: code,
              requestedAt: new Date().toISOString(),
            },
          },
        );
      }
      return { registered: true };
    },

    async registerProviderDataExportSchedule() {
      const queue = queues[QUEUE_NAMES.providerDataExport];
      if (
        !shouldRegisterProviderDataExportSchedule(
          container.env.APP_ENV,
          container.env.PROVIDER_DATA_ROLE,
        )
      ) {
        await queue.removeJobScheduler(PROVIDER_DATA_EXPORT_SCHEDULER_ID).catch(() => undefined);
        container.logger.info(
          {
            event: "provider_data_export_schedule_skipped",
            appEnv: container.env.APP_ENV,
            providerDataRole: container.env.PROVIDER_DATA_ROLE,
          },
          "provider-data export schedule not registered for this APP_ENV/role",
        );
        return { registered: false };
      }
      await queue.upsertJobScheduler(
        PROVIDER_DATA_EXPORT_SCHEDULER_ID,
        providerDataExportRepeatOpts(),
        {
          name: QUEUE_NAMES.providerDataExport,
          data: providerDataExportJobSchema.parse({
            trigger: "schedule",
            requestedAt: new Date().toISOString(),
          }),
        },
      );
      return { registered: true };
    },

    async registerProviderDataImportSchedule() {
      const queue = queues[QUEUE_NAMES.providerDataImport];
      if (
        !shouldRegisterProviderDataImportSchedule(
          container.env.APP_ENV,
          container.env.PROVIDER_DATA_ROLE,
        )
      ) {
        await queue.removeJobScheduler(PROVIDER_DATA_IMPORT_SCHEDULER_ID).catch(() => undefined);
        container.logger.info(
          {
            event: "provider_data_import_schedule_skipped",
            appEnv: container.env.APP_ENV,
            providerDataRole: container.env.PROVIDER_DATA_ROLE,
          },
          "provider-data import schedule not registered for this APP_ENV/role",
        );
        return { registered: false };
      }
      await queue.upsertJobScheduler(
        PROVIDER_DATA_IMPORT_SCHEDULER_ID,
        providerDataImportRepeatOpts(),
        {
          name: QUEUE_NAMES.providerDataImport,
          data: providerDataImportJobSchema.parse({
            trigger: "schedule",
            requestedAt: new Date().toISOString(),
          }),
        },
      );
      return { registered: true };
    },

    getRefreshCharacterQueue() {
      return queues[QUEUE_NAMES.refreshCharacter] ?? null;
    },

    getCalibrationRunQueue() {
      return queues[QUEUE_NAMES.calibrationRun] ?? null;
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
