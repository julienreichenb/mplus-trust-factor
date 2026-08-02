import type { EvidenceCandidateMetadataV2, EvidenceRole } from "@mplus/contracts";
import { hashRefreshContract } from "@mplus/contracts";
import type { WorkerContainer } from "../../container.js";
import { createQueueProducers } from "../../queues.js";
import {
  isScoringV2ShadowOrchestrationEnabled,
  startEvidenceV2ShadowPipeline,
} from "./index.js";

/**
 * Best-effort V2 shadow fan-out from the V1 refresh pipeline.
 * Failures never fail the V1 refresh. No-op when Scoring V2 flags are off.
 * Never mutates the public score pointer.
 */
export async function maybeStartScoringV2ShadowFromRefresh(input: {
  container: WorkerContainer;
  characterId: string;
  seasonId: string;
  seasonSlug: string;
  role: EvidenceRole;
  specSlug: string | null;
  refreshContract: Parameters<typeof hashRefreshContract>[0];
  evidenceCutoffAt: string;
  highKeyPolicyId: string;
  activeDungeonSlugs: string[];
  candidates: EvidenceCandidateMetadataV2[];
  scoreModelId: string;
  parentIngestionJobId: string | null;
  correlationId: string | null;
  refreshGeneration: number;
  region: string;
}): Promise<void> {
  if (!isScoringV2ShadowOrchestrationEnabled(input.container.env)) {
    return;
  }

  const redis = input.container.createRedisConnection();
  const producers = createQueueProducers(redis, input.container);
  try {
    const result = await startEvidenceV2ShadowPipeline(
      input.container,
      {
        characterId: input.characterId,
        seasonId: input.seasonId,
        seasonSlug: input.seasonSlug,
        role: input.role,
        specSlug: input.specSlug,
        refreshContractHash: hashRefreshContract(input.refreshContract),
        evidenceCutoffAt: input.evidenceCutoffAt,
        highKeyPolicyId: input.highKeyPolicyId,
        activeDungeonSlugs: input.activeDungeonSlugs,
        candidates: input.candidates,
        scoreModelId: input.scoreModelId,
        parentIngestionJobId: input.parentIngestionJobId,
        correlationId: input.correlationId,
        refreshGeneration: input.refreshGeneration,
        region: input.region,
      },
      {
        enqueueAnalyzeEvidenceSlot: (job) => producers.enqueueAnalyzeEvidenceSlot(job),
      },
    );

    if (
      !result.skipped &&
      !result.deferred &&
      result.analysisBatchId &&
      (result.enqueuedSlotJobs ?? 0) === 0
    ) {
      await producers.enqueueFinalizeEvidenceBatch({
        analysisBatchId: result.analysisBatchId,
        acquisitionPlanContentHash: result.acquisitionPlanContentHash!,
        expectedTerminalSlotCount: 0,
        refreshGeneration: input.refreshGeneration,
        correlationId: input.correlationId,
      });
    }

    input.container.logger.info(
      {
        event: "scoring_v2_shadow_enqueue",
        ...result,
        characterId: input.characterId,
        publicationBlocked: true,
      },
      "scoring v2 shadow pipeline enqueue result",
    );
  } catch (error) {
    input.container.logger.warn(
      {
        err: error,
        event: "scoring_v2_shadow_enqueue_failed",
        characterId: input.characterId,
      },
      "scoring v2 shadow enqueue failed — V1 refresh continues",
    );
  } finally {
    await producers.close();
    await redis.quit();
  }
}
