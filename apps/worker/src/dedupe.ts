import { createHash } from "node:crypto";
import {
  QUEUE_NAMES,
  type AnalyzeEvidenceSlotJobV2,
  type AnalyzeRunJob,
  type BulkOrchestratorJob,
  type DiscoverOwnedCharactersJob,
  type FinalizeEvidenceBatchJobV2,
  type GenerateAddonExportJob,
  type QueueName,
  type RecalculateScoreJob,
  type RefreshCharacterJob,
  type RelevantCharacterDiscoveryJob,
} from "@mplus/contracts";

export function buildDedupeKey(queue: QueueName, parts: string[]): string {
  const material = [queue, ...parts].join("|");
  return createHash("sha256").update(material, "utf8").digest("hex");
}

export function refreshCharacterDedupeKey(job: RefreshCharacterJob): string {
  return buildDedupeKey(QUEUE_NAMES.refreshCharacter, [
    job.region,
    job.realmSlug,
    job.name.toLocaleLowerCase("en-US"),
    String(job.forceRefresh),
    // Force refreshes must not collapse onto a completed job — each request publishes a new snapshot.
    job.forceRefresh ? job.requestedAt : "",
    // Model / adapter / schema bumps must not reuse jobs from a prior refresh contract.
    job.refreshContractHash ?? "",
  ]);
}

export function analyzeRunDedupeKey(job: AnalyzeRunJob): string {
  return buildDedupeKey(QUEUE_NAMES.analyzeRun, [
    job.runId,
    job.characterId,
    job.selectionKind,
    job.analysisVersion,
  ]);
}

export function recalculateScoreDedupeKey(job: RecalculateScoreJob): string {
  return buildDedupeKey(QUEUE_NAMES.recalculateScore, [
    job.characterId,
    job.seasonId,
    job.scoreModelKey,
    String(job.scoreModelVersion),
  ]);
}

export function generateAddonExportDedupeKey(job: GenerateAddonExportJob): string {
  return buildDedupeKey(QUEUE_NAMES.generateAddonExport, [
    job.region,
    job.seasonId,
    job.scoreModelKey,
    String(job.scoreModelVersion),
  ]);
}

export function syncRealmCatalogDedupeKey(parts: {
  regions?: string[] | null;
  forceDetails?: boolean;
}): string {
  const regions = (parts.regions ?? ["EU", "US", "KR", "TW"]).map((r) => r.toUpperCase()).sort();
  return buildDedupeKey(QUEUE_NAMES.syncRealmCatalog, [
    regions.join(","),
    String(parts.forceDetails === true),
  ]);
}

/** Deduped by Battle.net account + current season + ownership sync revision. */
export function discoverOwnedCharactersDedupeKey(job: DiscoverOwnedCharactersJob): string {
  return buildDedupeKey(QUEUE_NAMES.discoverOwnedCharacters, [
    job.battleNetAccountId,
    job.seasonKey,
    job.ownershipSyncAt,
  ]);
}

/** Daily discovery is idempotent per UTC date + region; drain feeds may repeat. */
export function relevantCharacterDiscoveryDedupeKey(job: RelevantCharacterDiscoveryJob): string {
  const day =
    job.mode === "daily_discovery" ? job.requestedAt.slice(0, 10) : job.requestedAt.slice(0, 16);
  return buildDedupeKey(QUEUE_NAMES.relevantCharacterDiscovery, [
    job.mode,
    job.regionCode,
    day,
  ]);
}

/**
 * must not be blocked by a completed prior tick — append requestedAt for uniqueness of
 * successive ticks while create/resume uses a stable key until terminal.
 */
export function bulkCharacterProcessingDedupeKey(job: BulkOrchestratorJob): string {
  return buildDedupeKey(QUEUE_NAMES.bulkCharacterProcessing, [
    job.bulkOperationId,
    job.requestedAt,
  ]);
}

/** slot: plan hash + slot ID + fact extractor set */
export function analyzeEvidenceSlotV2DedupeKey(job: AnalyzeEvidenceSlotJobV2): string {
  return buildDedupeKey(QUEUE_NAMES.analyzeEvidenceSlot, [
    job.acquisitionPlanContentHash,
    job.slotId,
    "evidence-v2-shadow",
    "0.1.0",
  ]);
}

/** finalize: batch ID + plan hash (+ generation) */
export function finalizeEvidenceBatchV2DedupeKey(job: FinalizeEvidenceBatchJobV2): string {
  return buildDedupeKey(QUEUE_NAMES.finalizeAnalysisBatch, [
    job.analysisBatchId,
    job.acquisitionPlanContentHash,
    String(job.refreshGeneration),
  ]);
}
