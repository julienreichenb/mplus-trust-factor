/**
 * Public surface consumed by `@mplus/api`. Keeps Prisma out of route handlers by exposing
 * the worker's DI container, repositories, queue producers, and dedupe helpers.
 */
export { createWorkerContainer, type WorkerContainer, type WorkerContainerOverrides, type WorkerProviders } from "./container.js";

export {
  analyzeRunDedupeKey,
  buildDedupeKey,
  bulkCharacterProcessingDedupeKey,
  discoverOwnedCharactersDedupeKey,
  generateAddonExportDedupeKey,
  recalculateScoreDedupeKey,
  refreshCharacterDedupeKey,
  syncRealmCatalogDedupeKey,
} from "./dedupe.js";

export { closeWorkers, createWorkers } from "./processors.js";
export { createQueueProducers, type EnqueueResult, type QueueProducers } from "./queues.js";

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
