import type { FinalizeEvidenceBatchJobV2 } from "@mplus/contracts";
import type { CharacterRole } from "@mplus/database";
import { finalizeEvidenceManifestV2 } from "@mplus/scoring";
import type { WorkerContainer } from "../../container.js";
import {
  assertPublicationBlocked,
  collectAcquisitionResultsForFinalize,
} from "./acquisition.js";

/**
 * Provider-free fan-in finalizer:
 * 1. CAS claim finalization
 * 2. finalizeEvidenceManifestV2 from acquisition results
 * 3. persist frozen manifest
 * 4. optional dimension computation placeholders (shadow)
 * 5. NEVER mutate CharacterPublishedScore / public pointer
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

  if (!container.env.SCORING_V2_ENABLED) {
    return { outcome: "flags_off", analysisBatchId: job.analysisBatchId };
  }

  const repo = container.repositories.evidenceV2Batch;
  const existing = await repo.getById(job.analysisBatchId);
  if (!existing) {
    return { outcome: "batch_not_found", analysisBatchId: job.analysisBatchId };
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
      return {
        outcome: "already_finalized",
        analysisBatchId: job.analysisBatchId,
        manifestId: latest.meta.manifestId ?? undefined,
        manifestContentHash: latest.meta.manifestContentHash ?? undefined,
      };
    }
    return { outcome: "claim_lost_or_not_ready", analysisBatchId: job.analysisBatchId };
  }

  // Provider-free from here — no Blizzard / WCL / Raider.IO calls.
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

  // Ensure dungeon rows exist for any missing slugs (shadow fixtures / early seasons).
  for (const slug of dungeonSlugs) {
    if (dungeonIdBySlug.has(slug)) continue;
    const created = await container.prisma.dungeon.create({
      data: { slug, name: slug },
    });
    dungeonIdBySlug.set(slug, created.id);
  }

  const role = manifest.role as CharacterRole;
  const { manifest: persisted, slots: persistedSlots } =
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

  // Shadow dimension placeholders — provider-free; no public publication.
  if (container.env.SCORING_V2_DIMENSIONS_ENABLED) {
    const now = new Date();
    const dimensions = [
      { dim: "PERFORMANCE" as const, enabled: container.env.SCORING_V2_PERFORMANCE_ENABLED },
      { dim: "SURVIVAL" as const, enabled: container.env.SCORING_V2_SURVIVAL_ENABLED },
      { dim: "UTILITY" as const, enabled: container.env.SCORING_V2_UTILITY_ENABLED },
      { dim: "EXPERIENCE" as const, enabled: container.env.SCORING_V2_EXPERIENCE_ENABLED },
    ];
    for (const { dim, enabled } of dimensions) {
      if (!enabled) continue;
      try {
        await container.repositories.evidence.createDimensionComputation({
          characterId: claimed.batch.characterId,
          seasonId: claimed.batch.seasonId,
          manifestId: persisted.id,
          scoreModelId: claimed.batch.scoreModelId,
          dimension: dim,
          algorithmVersion: "scoring-v2-shadow-placeholder-0.1.0",
          inputFingerprint: `${manifest.contentHash}:${dim}`,
          score: null,
          confidence: 0,
          state: "SHADOW",
          metrics: {
            selectedSlotCount: manifest.selectedSlotCount,
            expectedSlotCount: manifest.expectedSlotCount,
            persistedSlotRows: persistedSlots.length,
          },
          explanation: {
            mode: "shadow_placeholder",
            publicationBlocked: true,
          },
          computedAt: now,
        });
      } catch {
        // Unique fingerprint — idempotent redelivery.
      }
    }
  }

  // Explicitly do NOT touch CharacterPublishedScore / publish pointer.
  await repo.markAdmissionReleased(job.analysisBatchId);
  await repo.markFinalized(job.analysisBatchId);

  container.logger.info(
    {
      event: "scoring_v2_batch_finalized",
      analysisBatchId: job.analysisBatchId,
      manifestId: persisted.id,
      manifestContentHash: manifest.contentHash,
      publicationBlocked: true,
      selectedSlotCount: manifest.selectedSlotCount,
    },
    "scoring v2 shadow batch finalized without public publication",
  );

  return {
    outcome: "finalized",
    analysisBatchId: job.analysisBatchId,
    manifestId: persisted.id,
    manifestContentHash: manifest.contentHash,
  };
}
