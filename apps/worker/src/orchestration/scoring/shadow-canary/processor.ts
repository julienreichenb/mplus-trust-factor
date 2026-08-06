/**
 * BullMQ processor for Scoring V2 Shadow Canary jobs.
 */
import type { ScoringV2ShadowCanaryJob } from "@mplus/contracts";
import type { WorkerContainer } from "../../../container.js";
import { toInputJsonValue } from "../../../persistence/prisma-json.js";
import { discoverShadowCanaryCandidates } from "./discover.js";
import { runShadowCanaryJob } from "./runner.js";

export async function runScoringV2ShadowCanaryJob(
  container: WorkerContainer,
  job: ScoringV2ShadowCanaryJob,
): Promise<{
  outcome: string;
  canaryId: string;
  analysisBatchId: string | null;
  enqueuedSlotJobs: number;
}> {
  const canary = await container.prisma.scoringV2ShadowCanary.findUnique({
    where: { id: job.canaryId },
  });
  if (!canary) {
    return {
      outcome: "canary_not_found",
      canaryId: job.canaryId,
      analysisBatchId: null,
      enqueuedSlotJobs: 0,
    };
  }

  if (canary.status === "COMPLETED") {
    return {
      outcome: "already_completed",
      canaryId: job.canaryId,
      analysisBatchId: canary.analysisBatchId,
      enqueuedSlotJobs: 0,
    };
  }

  try {
    const discovery = await discoverShadowCanaryCandidates({
      container,
      region: job.region,
      realmSlug: job.realmSlug,
      characterName: job.characterName,
      characterId: canary.characterId,
    });

    await container.prisma.scoringV2ShadowCanary.update({
      where: { id: job.canaryId },
      data: {
        seasonId: discovery.seasonId,
        diagnostics: toInputJsonValue({
          ...(typeof canary.diagnostics === "object" && canary.diagnostics
            ? (canary.diagnostics as Record<string, unknown>)
            : {}),
          discovery: discovery.diagnostics,
          activeDungeonSlugs: discovery.activeDungeonSlugs,
          candidateCount: discovery.candidates.length,
        }),
      },
    });

    const result = await runShadowCanaryJob({
      container,
      canaryId: job.canaryId,
      candidates: discovery.candidates,
      activeDungeonSlugs: discovery.activeDungeonSlugs,
      seasonId: discovery.seasonId,
      seasonSlug: discovery.seasonSlug,
      scoreModelId: discovery.scoreModelId,
      highKeyPolicyId: discovery.highKeyPolicyId,
      region: job.region,
    });

    return {
      outcome: "enqueued",
      canaryId: job.canaryId,
      analysisBatchId: result.analysisBatchId,
      enqueuedSlotJobs: result.enqueuedSlotJobs,
    };
  } catch (error) {
    await container.prisma.scoringV2ShadowCanary.update({
      where: { id: job.canaryId },
      data: {
        status: "FAILED",
        errorCode: "CANARY_DISCOVERY_OR_ENQUEUE_FAILED",
        errorMessage: error instanceof Error ? error.message : String(error),
        completedAt: new Date(),
      },
    });
    throw error;
  }
}
