import type { AnalyzeEvidenceSlotJobV2, FinalizeEvidenceBatchJobV2 } from "@mplus/contracts";
import { discoveryIdentityKey } from "@mplus/contracts";
import type { WorkerContainer } from "../../container.js";
import {
  acquireCandidateWithFallback,
  assertPublicationBlocked,
  ScoringV2CancelledError,
  ScoringV2SupersededError,
} from "./acquisition.js";

export interface EvidenceV2SlotProducers {
  enqueueFinalizeEvidenceBatch: (
    input: Omit<FinalizeEvidenceBatchJobV2, "requestedAt" | "schemaVersion"> & {
      requestedAt?: string;
    },
  ) => Promise<{ jobId: string }>;
}

/**
 * Provider-aware slot acquisition with ordered fallbacks from EvidenceAcquisitionPlanV2.
 * Terminal redelivery is a no-op. Does not freeze EvidenceManifestV2.
 */
export async function runAnalyzeEvidenceSlotV2(
  container: WorkerContainer,
  job: AnalyzeEvidenceSlotJobV2,
  producers: EvidenceV2SlotProducers,
): Promise<{
  outcome: string;
  analysisBatchId: string;
  slotId: string;
  status?: string;
}> {
  assertPublicationBlocked(container.env);

  if (!container.env.SCORING_V2_ENABLED || !container.env.SCORING_V2_EVIDENCE_FETCH_ENABLED) {
    return {
      outcome: "flags_off",
      analysisBatchId: job.analysisBatchId,
      slotId: job.slotId,
    };
  }

  const repo = container.repositories.evidenceV2Batch;
  const view = await repo.getById(job.analysisBatchId);
  if (!view) {
    return { outcome: "batch_not_found", analysisBatchId: job.analysisBatchId, slotId: job.slotId };
  }

  if (view.meta.acquisitionPlanContentHash !== job.acquisitionPlanContentHash) {
    return {
      outcome: "plan_hash_mismatch",
      analysisBatchId: job.analysisBatchId,
      slotId: job.slotId,
    };
  }

  const claim = await repo.claimSlot({
    batchId: job.analysisBatchId,
    slotId: job.slotId,
    refreshGeneration: job.refreshGeneration,
  });

  if (claim.outcome === "already_terminal") {
    return {
      outcome: "terminal_redelivery_noop",
      analysisBatchId: job.analysisBatchId,
      slotId: job.slotId,
      status: claim.view.meta.slots.find((s) => s.slotId === job.slotId)?.status,
    };
  }
  if (claim.outcome === "cancelled") {
    throw new ScoringV2CancelledError();
  }
  if (claim.outcome === "superseded" || claim.outcome === "generation_mismatch") {
    throw new ScoringV2SupersededError();
  }
  if (claim.outcome === "lost_claim") {
    return {
      outcome: "lost_claim",
      analysisBatchId: job.analysisBatchId,
      slotId: job.slotId,
    };
  }
  if (claim.outcome !== "claimed") {
    return { outcome: "slot_not_found", analysisBatchId: job.analysisBatchId, slotId: job.slotId };
  }

  const batchView = claim.view;
  const slotPlan = batchView.meta.acquisitionPlan.slots.find((s) => s.slotId === job.slotId);
  if (!slotPlan) {
    await repo.completeSlot({
      batchId: job.analysisBatchId,
      slotId: job.slotId,
      status: "FAILED",
      terminalReason: "SLOT_PLAN_MISSING",
    });
    return { outcome: "slot_plan_missing", analysisBatchId: job.analysisBatchId, slotId: job.slotId };
  }

  // Empty ordered candidates → unavailable without provider calls.
  if (slotPlan.orderedCandidates.length === 0) {
    const completed = await repo.completeSlot({
      batchId: job.analysisBatchId,
      slotId: job.slotId,
      status: "UNAVAILABLE",
      terminalReason: slotPlan.provisionalMissingState ?? "MISSING_NO_CANDIDATE",
    });
    if (completed.becameReady) {
      await producers.enqueueFinalizeEvidenceBatch({
        analysisBatchId: job.analysisBatchId,
        acquisitionPlanContentHash: job.acquisitionPlanContentHash,
        expectedTerminalSlotCount: batchView.meta.acquisitionPlan.expectedSlotCount,
        refreshGeneration: job.refreshGeneration,
        correlationId: job.correlationId ?? null,
      });
    }
    return {
      outcome: "unavailable_no_candidates",
      analysisBatchId: job.analysisBatchId,
      slotId: job.slotId,
      status: "UNAVAILABLE",
    };
  }

  const character = await container.prisma.character.findUnique({
    where: { id: batchView.batch.characterId },
    include: { region: true },
  });
  const region = character?.region?.code ?? "EU";

  try {
    const acquired = await acquireCandidateWithFallback({
      container,
      candidates: slotPlan.orderedCandidates,
      region,
      correlationId: job.correlationId ?? null,
      shouldCancel: async () => {
        const latest = await repo.getById(job.analysisBatchId);
        return Boolean(latest?.meta.cancelled || latest?.meta.supersededByGeneration != null);
      },
      evidence: container.repositories.evidence,
      artifacts: container.repositories.artifacts,
      manifestSlotIdForPersistence: null,
      characterId: batchView.batch.characterId,
    });

    const status =
      acquired.result.acquisitionStatus === "ACQUIRED"
        ? acquired.result.dimensionValidity?.performance === "VALID" &&
          acquired.result.dimensionValidity?.survival === "VALID" &&
          acquired.result.dimensionValidity?.utility === "VALID"
          ? ("SUCCEEDED" as const)
          : ("PARTIAL" as const)
        : ("UNAVAILABLE" as const);

    const completed = await repo.completeSlot({
      batchId: job.analysisBatchId,
      slotId: job.slotId,
      status,
      terminalReason:
        acquired.result.acquisitionStatus === "ACQUIRED"
          ? null
          : acquired.result.rejectionReason,
      acquisitionResult: acquired.result,
      acquiredDiscoveryKey: discoveryIdentityKey(acquired.result.discoveryIdentity),
      datasetCompatibilityKeys: acquired.datasetCompatibilityKeys,
      factSetFingerprint: acquired.factSetFingerprint,
    });

    if (completed.becameReady) {
      await producers.enqueueFinalizeEvidenceBatch({
        analysisBatchId: job.analysisBatchId,
        acquisitionPlanContentHash: job.acquisitionPlanContentHash,
        expectedTerminalSlotCount: batchView.meta.acquisitionPlan.expectedSlotCount,
        refreshGeneration: job.refreshGeneration,
        correlationId: job.correlationId ?? null,
      });
    }

    return {
      outcome: "completed",
      analysisBatchId: job.analysisBatchId,
      slotId: job.slotId,
      status,
    };
  } catch (error) {
    if (error instanceof ScoringV2CancelledError) {
      await repo.completeSlot({
        batchId: job.analysisBatchId,
        slotId: job.slotId,
        status: "CANCELLED",
        terminalReason: "CANCELLED",
      });
      throw error;
    }
    if (error instanceof ScoringV2SupersededError) {
      await repo.completeSlot({
        batchId: job.analysisBatchId,
        slotId: job.slotId,
        status: "SUPERSEDED",
        terminalReason: "SUPERSEDED",
      });
      throw error;
    }
    const completed = await repo.completeSlot({
      batchId: job.analysisBatchId,
      slotId: job.slotId,
      status: "FAILED",
      terminalReason: error instanceof Error ? error.message : "SLOT_ACQUISITION_FAILED",
    });
    if (completed.becameReady) {
      await producers.enqueueFinalizeEvidenceBatch({
        analysisBatchId: job.analysisBatchId,
        acquisitionPlanContentHash: job.acquisitionPlanContentHash,
        expectedTerminalSlotCount: batchView.meta.acquisitionPlan.expectedSlotCount,
        refreshGeneration: job.refreshGeneration,
        correlationId: job.correlationId ?? null,
      });
    }
    throw error;
  }
}
