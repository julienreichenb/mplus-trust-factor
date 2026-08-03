import type { FinalizeEvidenceBatchJobV2 } from "@mplus/contracts";
import type { CharacterRole } from "@mplus/database";
import {
  OBS_EVENTS,
  emitScoringV2Event,
  recordBatchOutcome,
  recordFinalizationRecovery,
  recordManifestCoverage,
  recordPublicationDecision,
} from "@mplus/observability";
import { finalizeEvidenceManifestV2 } from "@mplus/scoring";
import type { WorkerContainer } from "../../container.js";
import {
  assertPublicationBlocked,
  collectAcquisitionResultsForFinalize,
} from "./acquisition.js";
import {
  persistShadowDimensionComputations,
  resolveEnabledShadowDimensions,
} from "./dimension-finalizer.js";
import { persistTypedFactSet } from "./typed-fact-persist.js";
import {
  addProviderAccounting,
  aggregateProviderAccounting,
} from "./provider-accounting.js";

/**
 * Provider-free fan-in finalizer:
 * 1. CAS claim finalization
 * 2. finalizeEvidenceManifestV2 from acquisition results
 * 3. persist frozen manifest (skip recreate when already attached)
 * 4. shadow dimension finalization (UNAVAILABLE when facts not calculator-ready)
 * 5. NEVER mutate CharacterPublishedScore / public pointer
 *
 * Partial dimension persistence policy (SHADOW):
 * - Persistence attempts are isolated per dimension.
 * - If any dimension persist fails, release FINALIZING → READY_TO_FINALIZE and
 *   fail the job so redelivery can reclaim (idempotent dimension writes).
 * - Successful sibling writes remain; redelivery is conflict-safe.
 */
export async function runFinalizeEvidenceBatchV2(
  container: WorkerContainer,
  job: FinalizeEvidenceBatchJobV2,
): Promise<{
  outcome: string;
  analysisBatchId: string;
  manifestId?: string;
  manifestContentHash?: string;
}> {
  assertPublicationBlocked(container.env);

  const repo = container.repositories.evidenceV2Batch;
  const existing = await repo.getById(job.analysisBatchId);
  if (!existing) {
    // Preserve flags_off when V2 is disabled and the batch is absent (isolation tests).
    if (!container.env.SCORING_V2_ENABLED) {
      return { outcome: "flags_off", analysisBatchId: job.analysisBatchId };
    }
    return { outcome: "batch_not_found", analysisBatchId: job.analysisBatchId };
  }

  if (!container.env.SCORING_V2_ENABLED && existing.meta.adminShadowCanary !== true) {
    return { outcome: "flags_off", analysisBatchId: job.analysisBatchId };
  }

  if (existing.batch.finalizationStatus === "FINALIZED") {
    return {
      outcome: "already_finalized",
      analysisBatchId: job.analysisBatchId,
      manifestId: existing.meta.manifestId ?? undefined,
      manifestContentHash: existing.meta.manifestContentHash ?? undefined,
    };
  }

  if (existing.meta.acquisitionPlanContentHash !== job.acquisitionPlanContentHash) {
    return { outcome: "plan_hash_mismatch", analysisBatchId: job.analysisBatchId };
  }

  if (existing.meta.refreshGeneration !== job.refreshGeneration) {
    return { outcome: "generation_mismatch", analysisBatchId: job.analysisBatchId };
  }

  if (existing.meta.cancelled) {
    return { outcome: "cancelled", analysisBatchId: job.analysisBatchId };
  }

  const claimed = await repo.claimFinalization(job.analysisBatchId);
  if (!claimed) {
    // Concurrent finalizer won, or not ready — redelivery-safe.
    const latest = await repo.getById(job.analysisBatchId);
    if (latest?.batch.finalizationStatus === "FINALIZED") {
      recordFinalizationRecovery("reclaim");
      emitScoringV2Event(container.logger, OBS_EVENTS.scoringV2FinalizationReclaim, {
        analysisBatchId: job.analysisBatchId,
        correlationId: job.correlationId,
        outcome: "already_finalized",
      });
      return {
        outcome: "already_finalized",
        analysisBatchId: job.analysisBatchId,
        manifestId: latest.meta.manifestId ?? undefined,
        manifestContentHash: latest.meta.manifestContentHash ?? undefined,
      };
    }
    recordFinalizationRecovery("claim_lost");
    emitScoringV2Event(
      container.logger,
      OBS_EVENTS.scoringV2FinalizationClaimLost,
      {
        analysisBatchId: job.analysisBatchId,
        correlationId: job.correlationId,
        outcome: "claim_lost_or_not_ready",
      },
      "warn",
    );
    return { outcome: "claim_lost_or_not_ready", analysisBatchId: job.analysisBatchId };
  }

  try {
    // Provider-free from here — no Blizzard / WCL / Raider.IO calls.
    // Never touch CharacterPublishedScore / publish pointer.
    let manifestId = claimed.meta.manifestId;
    let manifestContentHash = claimed.meta.manifestContentHash;
    let manifestDocument = claimed.meta.manifestId
      ? ((
          await container.prisma.evidenceManifest.findUnique({
            where: { id: claimed.meta.manifestId },
          })
        )?.document as unknown)
      : null;

    // Successful CAS after a prior release → redelivery reclaim of in-progress finalize.
    if (manifestId && manifestContentHash) {
      recordFinalizationRecovery("reclaim");
      emitScoringV2Event(container.logger, OBS_EVENTS.scoringV2FinalizationReclaim, {
        analysisBatchId: job.analysisBatchId,
        correlationId: job.correlationId,
        characterId: claimed.batch.characterId,
        outcome: "reclaim_with_manifest",
      });
    }

    if (!manifestId || !manifestContentHash || !manifestDocument) {
      const plan = claimed.meta.acquisitionPlan;
      const acquisitionResults = collectAcquisitionResultsForFinalize(claimed.meta.slots);
      const { manifest } = finalizeEvidenceManifestV2({
        plan,
        acquisitionResults,
        selectedAt: new Date().toISOString(),
      });

      const dungeonSlugs = [...new Set(manifest.slots.map((s) => s.dungeonSlug))];
      const dungeons = await container.prisma.dungeon.findMany({
        where: { slug: { in: dungeonSlugs } },
        select: { id: true, slug: true },
      });
      const dungeonIdBySlug = new Map(dungeons.map((d) => [d.slug, d.id]));

      for (const slug of dungeonSlugs) {
        if (dungeonIdBySlug.has(slug)) continue;
        const created = await container.prisma.dungeon.create({
          data: { slug, name: slug },
        });
        dungeonIdBySlug.set(slug, created.id);
      }

      const role = manifest.role as CharacterRole;
      const { manifest: persisted } =
        await container.repositories.evidence.createFrozenManifest({
          characterId: claimed.batch.characterId,
          seasonId: claimed.batch.seasonId,
          specializationId: null,
          role,
          refreshContractHash: manifest.refreshContractHash,
          selectorVersion: manifest.selectorVersion,
          highKeyPolicyId: manifest.highKeyPolicyId,
          evidenceCutoffAt: new Date(manifest.evidenceCutoffAt),
          expectedSlotCount: manifest.expectedSlotCount,
          selectedSlotCount: manifest.selectedSlotCount,
          coverageState: manifest.coverage.state,
          schemaVersion: manifest.schemaVersion,
          contentHash: manifest.contentHash,
          document: manifest as unknown as object,
          frozenAt: new Date(manifest.selectedAt),
          slots: manifest.slots.map((slot) => ({
            dungeonId: dungeonIdBySlug.get(slot.dungeonSlug)!,
            slotIndex: slot.slotIndex,
            reportCode: slot.identity?.reportCode ?? null,
            fightId: slot.identity?.fightId ?? null,
            reportRevision: slot.identity?.reportRevision ?? null,
            keyLevel: slot.keyLevel,
            candidateRank: slot.selectedRank,
            state: slot.state,
            selectionReason: slot.fallbackReason,
            dimensionValidity: slot.dimensionValidity ?? {},
            invalidReasons: [],
            providerDataAsOf: null,
          })),
        });

      await repo.attachManifest({
        batchId: job.analysisBatchId,
        manifestId: persisted.id,
        manifestContentHash: manifest.contentHash,
      });

      manifestId = persisted.id;
      manifestContentHash = manifest.contentHash;
      manifestDocument = manifest;

      const fallbackDepth = manifest.slots.reduce(
        (max, slot) => Math.max(max, slot.selectedRank ?? 0),
        0,
      );
      recordManifestCoverage({
        coverageState: manifest.coverage.state,
        selectedSlotCount: manifest.selectedSlotCount,
        expectedSlotCount: manifest.expectedSlotCount,
        fallbackDepth,
      });
      emitScoringV2Event(container.logger, OBS_EVENTS.scoringV2ManifestFrozen, {
        analysisBatchId: job.analysisBatchId,
        characterId: claimed.batch.characterId,
        correlationId: job.correlationId,
        manifestId,
        manifestContentHash,
        coverageState: manifest.coverage.state,
        selectedSlotCount: manifest.selectedSlotCount,
        expectedSlotCount: manifest.expectedSlotCount,
      });
    }

    // Persist typed fact sets extracted during acquisition (provider-free DB write).
    // Does not call providers; does not write shadow_placeholder.
    if (manifestId) {
      const latest = await repo.getById(job.analysisBatchId);
      const slots = latest?.meta.slots ?? claimed.meta.slots;
      const persistedSlots = await container.prisma.evidenceManifestSlot.findMany({
        where: { manifestId },
        select: {
          id: true,
          reportCode: true,
          fightId: true,
          reportRevision: true,
          slotIndex: true,
          dungeon: { select: { slug: true } },
        },
      });

      for (const slotRec of slots) {
        if (!slotRec.typedFactPayloads?.length) continue;
        const identity = slotRec.acquisitionResult?.discoveryIdentity;
        if (!identity) continue;
        const dbSlot = persistedSlots.find(
          (s) =>
            s.reportCode === identity.reportCode &&
            s.fightId === identity.fightId &&
            (slotRec.acquisitionResult?.reportRevision == null ||
              s.reportRevision === slotRec.acquisitionResult.reportRevision),
        );
        if (!dbSlot || slotRec.acquisitionResult?.reportRevision == null) continue;

        for (const payload of slotRec.typedFactPayloads) {
          const persisted = await persistTypedFactSet({
            evidence: container.repositories.evidence,
            logger: container.logger,
            characterId: claimed.batch.characterId,
            correlationId: job.correlationId,
            manifestSlotId: dbSlot.id,
            reportCode: identity.reportCode,
            fightId: identity.fightId,
            reportRevision: slotRec.acquisitionResult.reportRevision,
            classSlug: claimed.meta.acquisitionPlan.classSlug ?? null,
            specSlug: claimed.meta.acquisitionPlan.specSlug ?? null,
            payload,
          });
          if (persisted.outcome === "conflict") {
            throw new Error(
              `typed_fact_persist_conflict:${payload.dimension}:${persisted.reason}`,
            );
          }
        }
      }
    }

    // Shadow dimension finalization — provider-free; no public publication.
    // Admin Shadow Canary forces all four dimensions even when process env flags are off.
    const canaryDims = claimed.meta.adminShadowCanary === true;
    if (canaryDims || container.env.SCORING_V2_DIMENSIONS_ENABLED) {
      const enabledDimensions = canaryDims
        ? (["PERFORMANCE", "SURVIVAL", "UTILITY", "EXPERIENCE"] as Array<
            "PERFORMANCE" | "SURVIVAL" | "UTILITY" | "EXPERIENCE"
          >)
        : resolveEnabledShadowDimensions(container.env);
      if (enabledDimensions.length > 0) {
        const { finalization, persisted: dimRows, failed, allPersisted } =
          await persistShadowDimensionComputations(container, {
            characterId: claimed.batch.characterId,
            seasonId: claimed.batch.seasonId,
            scoreModelId: claimed.batch.scoreModelId,
            manifestId,
            manifestDocument: manifestDocument as never,
            expectedManifestContentHash: manifestContentHash,
            enabledDimensions,
            relativeDamageMode: container.env.SCORING_V2_RELATIVE_DAMAGE_MODE,
          });

        container.logger.info(
          {
            event: "scoring_v2_dimensions_finalized",
            analysisBatchId: job.analysisBatchId,
            manifestId,
            blockedReason: finalization.blockedReason,
            dimensions: dimRows,
            failedDimensions: failed,
            allPersisted,
            publicationBlocked: true,
          },
          "scoring v2 shadow dimensions persistence attempt complete",
        );

        if (!allPersisted) {
          throw new Error(
            `shadow_dimension_persist_partial_failure: failed=${failed
              .map((f) => `${f.dimension}:${f.error}`)
              .join("|")}`,
          );
        }
      }
    }

    // Explicitly do NOT touch CharacterPublishedScore / publish pointer.
    await repo.markAdmissionReleased(job.analysisBatchId);
    await repo.markFinalized(job.analysisBatchId);

    if (claimed.meta.adminShadowCanary === true && claimed.meta.shadowCanaryId) {
      const slotRows = claimed.meta.slots ?? [];
      const succeeded = slotRows.filter(
        (s) => s.status === "SUCCEEDED" || s.status === "PARTIAL",
      ).length;
      const unavailable = slotRows.filter((s) => s.status === "UNAVAILABLE").length;
      const prior = await container.prisma.scoringV2ShadowCanary.findUnique({
        where: { id: claimed.meta.shadowCanaryId },
        select: { progress: true, diagnostics: true },
      });
      const priorProgress =
        prior?.progress != null && typeof prior.progress === "object" && !Array.isArray(prior.progress)
          ? (prior.progress as Record<string, unknown>)
          : {};
      const priorDiagnostics =
        prior?.diagnostics != null &&
        typeof prior.diagnostics === "object" &&
        !Array.isArray(prior.diagnostics)
          ? (prior.diagnostics as Record<string, unknown>)
          : {};
      const discoveryCalls =
        priorDiagnostics.discovery != null &&
        typeof priorDiagnostics.discovery === "object" &&
        !Array.isArray(priorDiagnostics.discovery) &&
        typeof (priorDiagnostics.discovery as { providerCalls?: unknown }).providerCalls ===
          "number"
          ? ((priorDiagnostics.discovery as { providerCalls: number }).providerCalls ?? 0)
          : 0;
      const slotAccounting = aggregateProviderAccounting(
        slotRows.map((s) => s.providerAccounting),
      );
      const providerAccounting = addProviderAccounting(slotAccounting, {
        providerCalls: discoveryCalls,
      });
      await container.prisma.scoringV2ShadowCanary.update({
        where: { id: claimed.meta.shadowCanaryId },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          analysisBatchId: job.analysisBatchId,
          progress: {
            ...priorProgress,
            finalized: true,
            manifestId,
            manifestContentHash,
            slotSucceeded: succeeded,
            slotUnavailable: unavailable,
            slotTotal: slotRows.length,
          },
          diagnostics: {
            ...priorDiagnostics,
            providerAccounting: {
              ...providerAccounting,
              discoveryProviderCalls: discoveryCalls,
              acquisitionProviderCalls: slotAccounting.providerCalls,
            },
          },
        },
      });
    }

    recordBatchOutcome("finalized");
    recordPublicationDecision("rejected", "shadow_publication_blocked");
    emitScoringV2Event(container.logger, OBS_EVENTS.scoringV2BatchFinalized, {
      analysisBatchId: job.analysisBatchId,
      characterId: claimed.batch.characterId,
      correlationId: job.correlationId,
      manifestId,
      manifestContentHash,
      publicationBlocked: true,
    });
    emitScoringV2Event(container.logger, OBS_EVENTS.scoringV2PublicationRejected, {
      analysisBatchId: job.analysisBatchId,
      characterId: claimed.batch.characterId,
      correlationId: job.correlationId,
      reason: "shadow_publication_blocked",
    });

    return {
      outcome: "finalized",
      analysisBatchId: job.analysisBatchId,
      manifestId,
      manifestContentHash,
    };
  } catch (error) {
    // Minimal FINALIZING recovery: release claim so redelivery can reclaim.
    await repo.releaseFinalizationClaim(job.analysisBatchId);
    recordFinalizationRecovery("claim_released");
    emitScoringV2Event(
      container.logger,
      OBS_EVENTS.scoringV2FinalizationClaimReleased,
      {
        analysisBatchId: job.analysisBatchId,
        correlationId: job.correlationId,
        characterId: claimed.batch.characterId,
        outcome: "claim_released",
      },
      "warn",
    );
    throw error;
  }
}
