import type { AnalyzeEvidenceSlotJobV2, FinalizeEvidenceBatchJobV2 } from "@mplus/contracts";
import { discoveryIdentityKey } from "@mplus/contracts";
import {
  OBS_EVENTS,
  boundOperationalReason,
  emitScoringV2Event,
  normalizeOperationalError,
  recordBatchOutcome,
  recordSlotOutcome,
} from "@mplus/observability";
import type { WorkerContainer } from "../../container.js";
import {
  acquireCandidateWithFallback,
  assertPublicationBlocked,
  ScoringV2CancelledError,
  ScoringV2RateDeferError,
  ScoringV2SupersededError,
} from "./acquisition.js";
import { resolveFrozenClassSpecIdentity } from "./class-spec-identity.js";
import { createProviderBackedEvidenceTransport } from "./evidence-transport-provider.js";
import {
  acquirePerCharacterRunPermit,
  releasePerCharacterRunPermit,
  type WclConcurrencyRedis,
} from "./wcl-concurrency/permits.js";
import { randomUUID } from "node:crypto";

export interface EvidenceV2SlotProducers {
  enqueueFinalizeEvidenceBatch: (
    input: Omit<FinalizeEvidenceBatchJobV2, "requestedAt" | "schemaVersion"> & {
      requestedAt?: string;
    },
  ) => Promise<{ jobId: string }>;
}

function emitSlotTerminal(
  container: WorkerContainer,
  input: {
    analysisBatchId: string;
    slotId: string;
    correlationId?: string | null;
    characterId?: string;
    kind: "completed" | "unavailable" | "failed" | "cancelled";
    status: string;
    reason?: string;
  },
): void {
  if (input.kind === "completed" || input.kind === "unavailable") {
    recordSlotOutcome(input.kind === "unavailable" ? "unavailable" : "completed", input.status);
    emitScoringV2Event(container.logger, OBS_EVENTS.scoringV2SlotCompleted, {
      analysisBatchId: input.analysisBatchId,
      slotId: input.slotId,
      correlationId: input.correlationId,
      characterId: input.characterId,
      status: input.status,
      ...(input.reason ? { reason: boundOperationalReason(input.reason) } : {}),
    });
    return;
  }
  if (input.kind === "cancelled") {
    recordSlotOutcome("cancelled", input.status);
  } else {
    recordSlotOutcome("failed", input.status);
  }
  emitScoringV2Event(
    container.logger,
    OBS_EVENTS.scoringV2SlotFailed,
    {
      analysisBatchId: input.analysisBatchId,
      slotId: input.slotId,
      correlationId: input.correlationId,
      characterId: input.characterId,
      status: input.status,
      reason: boundOperationalReason(input.reason ?? input.status),
    },
    input.kind === "cancelled" ? "warn" : "error",
  );
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

  const repo = container.repositories.evidenceV2Batch;
  const viewEarly = await repo.getById(job.analysisBatchId);
  const canaryBypass = viewEarly?.meta.adminShadowCanary === true;

  if (
    !canaryBypass &&
    (!container.env.SCORING_V2_ENABLED || !container.env.SCORING_V2_EVIDENCE_FETCH_ENABLED)
  ) {
    return {
      outcome: "flags_off",
      analysisBatchId: job.analysisBatchId,
      slotId: job.slotId,
    };
  }

  const view = viewEarly;
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
    // Retry/redelivery of a terminal slot — no duplicate terminal events.
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

  recordSlotOutcome("started");
  emitScoringV2Event(container.logger, OBS_EVENTS.scoringV2SlotStarted, {
    analysisBatchId: job.analysisBatchId,
    slotId: job.slotId,
    correlationId: job.correlationId,
    refreshGeneration: job.refreshGeneration,
    characterId: claim.view.batch.characterId,
  });

  const batchView = claim.view;
  const slotPlan = batchView.meta.acquisitionPlan.slots.find((s) => s.slotId === job.slotId);
  if (!slotPlan) {
    await repo.completeSlot({
      batchId: job.analysisBatchId,
      slotId: job.slotId,
      status: "FAILED",
      terminalReason: "SLOT_PLAN_MISSING",
    });
    emitSlotTerminal(container, {
      analysisBatchId: job.analysisBatchId,
      slotId: job.slotId,
      correlationId: job.correlationId,
      characterId: batchView.batch.characterId,
      kind: "failed",
      status: "FAILED",
      reason: "SLOT_PLAN_MISSING",
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
    emitSlotTerminal(container, {
      analysisBatchId: job.analysisBatchId,
      slotId: job.slotId,
      correlationId: job.correlationId,
      characterId: batchView.batch.characterId,
      kind: "unavailable",
      status: "UNAVAILABLE",
      reason: slotPlan.provisionalMissingState ?? "MISSING_NO_CANDIDATE",
    });
    if (completed.becameReady) {
      recordBatchOutcome("ready");
      emitScoringV2Event(container.logger, OBS_EVENTS.scoringV2BatchReady, {
        analysisBatchId: job.analysisBatchId,
        correlationId: job.correlationId,
        characterId: batchView.batch.characterId,
      });
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
    include: { region: true, realm: true },
  });
  const region = character?.region?.code ?? "EU";
  if (!character?.displayName || !character.realm?.slug) {
    await repo.completeSlot({
      batchId: job.analysisBatchId,
      slotId: job.slotId,
      status: "FAILED",
      terminalReason: "CHARACTER_IDENTITY_INCOMPLETE",
    });
    emitSlotTerminal(container, {
      analysisBatchId: job.analysisBatchId,
      slotId: job.slotId,
      correlationId: job.correlationId,
      characterId: batchView.batch.characterId,
      kind: "failed",
      status: "FAILED",
      reason: "CHARACTER_IDENTITY_INCOMPLETE",
    });
    return {
      outcome: "character_identity_incomplete",
      analysisBatchId: job.analysisBatchId,
      slotId: job.slotId,
      status: "FAILED",
    };
  }
  const targetCharacter = {
    region: region as "EU" | "US" | "KR" | "TW",
    realmSlug: character.realm.slug,
    name: character.displayName,
  };

  // Frozen identity from immutable plan metadata — never invent from live profile.
  const frozenIdentity = resolveFrozenClassSpecIdentity({
    planClassSlug: batchView.meta.acquisitionPlan.classSlug ?? null,
    planSpecSlug: batchView.meta.acquisitionPlan.specSlug ?? null,
  });


  try {
    const redisConn = container.createRedisConnection();
    const redis = redisConn as unknown as WclConcurrencyRedis;
    const charOwnerId = `slot-char:${batchView.batch.characterId}:${job.slotId}:${randomUUID()}`;
    let charToken: string | null = null;
    try {
      const charPermit = await acquirePerCharacterRunPermit({
        redis,
        appEnv: container.env.APP_ENV,
        characterId: batchView.batch.characterId,
        ownerId: charOwnerId,
      });
      if (!charPermit.ok) {
        throw new ScoringV2RateDeferError(
          `per_character_wcl_permit_unavailable:${charPermit.reason}`,
          5_000,
        );
      }
      charToken = charPermit.token;

      const acquired = await acquireCandidateWithFallback({
        container,
        candidates: slotPlan.orderedCandidates,
        region,
        targetCharacter,
        correlationId: job.correlationId ?? null,
        shouldCancel: async () => {
          const latest = await repo.getById(job.analysisBatchId);
          return Boolean(latest?.meta.cancelled || latest?.meta.supersededByGeneration != null);
        },
        evidence: container.repositories.evidence,
        artifacts: container.repositories.artifacts,
        manifestSlotIdForPersistence: null,
        characterId: batchView.batch.characterId,
        datasetRequirements: batchView.meta.datasetRequirements,
        slotContext: {
          slotId: job.slotId,
          dungeonSlug: slotPlan.dungeonSlug,
          slotIndex: slotPlan.slotIndex,
        },
        transport: createProviderBackedEvidenceTransport(container, {
          characterId: batchView.batch.characterId,
        }),
        classSlug: frozenIdentity.classSlug,
        specSlug: frozenIdentity.specSlug,
        classSpecIdentity: frozenIdentity,
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
        typedFactPayloads: acquired.typedFactPayloads,
      });

      emitSlotTerminal(container, {
        analysisBatchId: job.analysisBatchId,
        slotId: job.slotId,
        correlationId: job.correlationId,
        characterId: batchView.batch.characterId,
        kind: status === "UNAVAILABLE" ? "unavailable" : "completed",
        status,
        reason: acquired.result.rejectionReason ?? undefined,
      });

      if (completed.becameReady) {
        recordBatchOutcome("ready");
        emitScoringV2Event(container.logger, OBS_EVENTS.scoringV2BatchReady, {
          analysisBatchId: job.analysisBatchId,
          correlationId: job.correlationId,
          characterId: batchView.batch.characterId,
        });
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
    } finally {
      if (charToken) {
        await releasePerCharacterRunPermit({
          redis,
          appEnv: container.env.APP_ENV,
          characterId: batchView.batch.characterId,
          ownerId: charOwnerId,
          token: charToken,
        }).catch(() => undefined);
      }
      await redisConn.quit().catch(() => undefined);
    }
  } catch (error) {
    // Permit/budget deferral: release claim so BullMQ retry can reclaim PENDING.
    if (error instanceof ScoringV2RateDeferError) {
      await repo.releaseSlotClaim({
        batchId: job.analysisBatchId,
        slotId: job.slotId,
        refreshGeneration: job.refreshGeneration,
      });
      throw error;
    }
    if (error instanceof ScoringV2CancelledError) {
      await repo.completeSlot({
        batchId: job.analysisBatchId,
        slotId: job.slotId,
        status: "CANCELLED",
        terminalReason: "CANCELLED",
      });
      emitSlotTerminal(container, {
        analysisBatchId: job.analysisBatchId,
        slotId: job.slotId,
        correlationId: job.correlationId,
        characterId: batchView.batch.characterId,
        kind: "cancelled",
        status: "CANCELLED",
        reason: "CANCELLED",
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
      emitSlotTerminal(container, {
        analysisBatchId: job.analysisBatchId,
        slotId: job.slotId,
        correlationId: job.correlationId,
        characterId: batchView.batch.characterId,
        kind: "cancelled",
        status: "SUPERSEDED",
        reason: "SUPERSEDED",
      });
      throw error;
    }
    const normalized = normalizeOperationalError(error);
    const completed = await repo.completeSlot({
      batchId: job.analysisBatchId,
      slotId: job.slotId,
      status: "FAILED",
      terminalReason: normalized.category,
    });
    emitSlotTerminal(container, {
      analysisBatchId: job.analysisBatchId,
      slotId: job.slotId,
      correlationId: job.correlationId,
      characterId: batchView.batch.characterId,
      kind: "failed",
      status: "FAILED",
      reason: normalized.category,
    });
    if (completed.becameReady) {
      recordBatchOutcome("ready");
      emitScoringV2Event(container.logger, OBS_EVENTS.scoringV2BatchReady, {
        analysisBatchId: job.analysisBatchId,
        correlationId: job.correlationId,
      });
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
