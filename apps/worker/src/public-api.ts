/**
 * Public surface consumed by `@mplus/api`. Keeps Prisma out of route handlers by exposing
 * the worker's DI container, repositories, queue producers, and dedupe helpers.
 */
export { createWorkerContainer, type WorkerContainer, type WorkerContainerOverrides, type WorkerProviders } from "./container.js";
export { runKeyDistributionRefresh, ingestFromLocalAddonFiles } from "./orchestration/key-distribution-refresh.js";

export {
  analyzeEvidenceSlotV2DedupeKey,
  analyzeRunDedupeKey,
  buildDedupeKey,
  bulkCharacterProcessingDedupeKey,
  discoverOwnedCharactersDedupeKey,
  finalizeEvidenceBatchV2DedupeKey,
  generateAddonExportDedupeKey,
  recalculateScoreDedupeKey,
  refreshCharacterDedupeKey,
  relevantCharacterDiscoveryDedupeKey,
  syncRealmCatalogDedupeKey,
} from "./dedupe.js";

export { closeWorkers, createWorkers } from "./processors.js";
export { createQueueProducers, type EnqueueResult, type QueueProducers } from "./queues.js";
export {
  shouldRegisterAutomaticBackgroundSchedulers,
  SCORING_SEASON_DATA_SYNC_CRON_PATTERN,
  SCORING_SEASON_DATA_SYNC_SCHEDULER_ID,
} from "./scheduling/automatic-schedulers.js";
export { loadRelevantRefreshSettings } from "./orchestration/relevant-refresh-settings.js";
export {
  runCalibrationRunJob,
  type CalibrationRunProcessorDeps,
  type CalibrationRunProcessorResult,
} from "./orchestration/calibration-run.js";

export { NegativeCache, negativeCache } from "./negative-cache.js";
export { pruneRawArtifacts, type PruneArtifactsResult } from "./prune-artifacts.js";

export {
  createDisabledProvider,
  createFixtureBlizzardProvider,
  ProviderDisabledError,
} from "./providers/fixture-providers.js";

export * from "./persistence/index.js";
export * from "./orchestration/index.js";
export { seedRefreshEligibilityEvidenceForTest } from "./test-eligibility-seed.js";
