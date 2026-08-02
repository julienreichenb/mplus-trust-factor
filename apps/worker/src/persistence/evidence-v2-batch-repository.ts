import type {
  EvidenceAcquisitionPlanV2,
  EvidenceCandidateAcquisitionResult,
  EvidenceV2BatchState,
  EvidenceV2EnabledConsumer,
  EvidenceV2SlotJobStatus,
} from "@mplus/contracts";
import type {
  Prisma,
  PrismaClient,
  ScoreAnalysisBatch,
  ScoreFinalizationStatus,
} from "@mplus/database";
import {
  emptySlotRecord,
  SCORING_V2_BATCH_METADATA_KEY,
  type EvidenceV2BatchMetadata,
  type EvidenceV2SlotRecord,
} from "../orchestration/scoring-v2/types.js";
import { resolveBatchDatasetRequirements } from "../orchestration/scoring-v2/dataset-requirements.js";
import type { TypedDimensionFactPayload } from "../orchestration/scoring-v2/typed-fact-persist.js";
import {
  isEvidenceV2SlotTerminal,
  recountEvidenceV2Slots,
} from "../orchestration/scoring-v2/fanin.js";

export interface CreateEvidenceV2BatchInput {
  characterId: string;
  seasonId: string;
  /** Dedicated UUID for V2 batch uniqueness (not the parent IngestionJob id). */
  refreshId: string;
  scoreModelId: string;
  acquisitionPlan: EvidenceAcquisitionPlanV2;
  refreshGeneration: number;
  parentIngestionJobId?: string | null;
  correlationId?: string | null;
  enabledConsumers: EvidenceV2EnabledConsumer[];
  deadlineAt?: Date | null;
}

export interface EvidenceV2BatchView {
  batch: ScoreAnalysisBatch;
  meta: EvidenceV2BatchMetadata;
}

export interface EvidenceV2BatchRepository {
  createBatch(input: CreateEvidenceV2BatchInput): Promise<EvidenceV2BatchView>;
  getById(id: string): Promise<EvidenceV2BatchView | null>;
  /** Compare-and-set claim PENDING → RUNNING. Terminal redelivery → no-op. */
  claimSlot(input: {
    batchId: string;
    slotId: string;
    refreshGeneration: number;
    now?: Date;
  }): Promise<
    | { outcome: "claimed"; view: EvidenceV2BatchView }
    | { outcome: "already_terminal"; view: EvidenceV2BatchView }
    | { outcome: "lost_claim"; view: EvidenceV2BatchView }
    | { outcome: "superseded" | "cancelled" | "not_found" | "generation_mismatch" }
  >;
  completeSlot(input: {
    batchId: string;
    slotId: string;
    status: Exclude<EvidenceV2SlotJobStatus, "PENDING" | "RUNNING">;
    terminalReason?: string | null;
    acquisitionResult?: EvidenceCandidateAcquisitionResult | null;
    acquiredDiscoveryKey?: string | null;
    datasetCompatibilityKeys?: string[];
    factSetFingerprint?: string | null;
    typedFactPayloads?: TypedDimensionFactPayload[];
    now?: Date;
  }): Promise<{ view: EvidenceV2BatchView; becameReady: boolean; wasAlreadyTerminal: boolean }>;
  markAdmissionDeferred(batchId: string, reason: string): Promise<EvidenceV2BatchView>;
  markAnalyzing(batchId: string): Promise<EvidenceV2BatchView>;
  markCancelled(batchId: string, reason: string): Promise<EvidenceV2BatchView>;
  markSuperseded(batchId: string, byGeneration: number): Promise<EvidenceV2BatchView>;
  /** Idempotent CAS: PENDING/READY → FINALIZING. */
  claimFinalization(batchId: string): Promise<EvidenceV2BatchView | null>;
  /**
   * Release a non-final FINALIZING claim back to READY_TO_FINALIZE so redelivery
   * can reclaim. No-op when already FINALIZED/FAILED/CANCELLED.
   */
  releaseFinalizationClaim(batchId: string): Promise<EvidenceV2BatchView | null>;
  attachManifest(input: {
    batchId: string;
    manifestId: string;
    manifestContentHash: string;
  }): Promise<EvidenceV2BatchView>;
  markFinalized(batchId: string): Promise<EvidenceV2BatchView>;
  markFailed(batchId: string, reason: string): Promise<EvidenceV2BatchView>;
  markAdmissionReleased(batchId: string): Promise<EvidenceV2BatchView>;
}

function parseMeta(metadata: unknown): EvidenceV2BatchMetadata | null {
  if (!metadata || typeof metadata !== "object") return null;
  const root = metadata as Record<string, unknown>;
  const raw = root[SCORING_V2_BATCH_METADATA_KEY];
  if (!raw || typeof raw !== "object") return null;
  const meta = raw as EvidenceV2BatchMetadata;
  // Backward-compatible defaults for in-flight batches created before CP2.
  if (!Array.isArray(meta.datasetRequirements)) {
    meta.datasetRequirements = resolveBatchDatasetRequirements(
      meta.enabledConsumers ?? ["PERFORMANCE", "SURVIVAL", "UTILITY"],
    );
  }
  for (const slot of meta.slots ?? []) {
    if (!Array.isArray(slot.typedFactPayloads)) {
      slot.typedFactPayloads = [];
    }
  }
  return meta;
}

function withMeta(
  metadata: unknown,
  meta: EvidenceV2BatchMetadata,
): Prisma.InputJsonValue {
  const base =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? { ...(metadata as Record<string, unknown>) }
      : {};
  return {
    ...base,
    [SCORING_V2_BATCH_METADATA_KEY]: meta,
  } as unknown as Prisma.InputJsonValue;
}

function countsToFinalization(meta: EvidenceV2BatchMetadata): {
  terminalRunCount: number;
  successfulRunCount: number;
  unavailableRunCount: number;
  failedRunCount: number;
  finalizationStatus: ScoreFinalizationStatus;
  batchState: EvidenceV2BatchState;
} {
  const recount = recountEvidenceV2Slots(
    meta.slots.map((s) => s.status),
    meta.acquisitionPlan.expectedSlotCount,
  );
  if (meta.cancelled) {
    return {
      terminalRunCount: recount.terminalSlotCount,
      successfulRunCount: recount.succeededSlotCount,
      unavailableRunCount: recount.unavailableSlotCount,
      failedRunCount: recount.failedSlotCount,
      finalizationStatus: "FAILED",
      batchState: "CANCELLED",
    };
  }
  if (meta.supersededByGeneration != null) {
    return {
      terminalRunCount: recount.terminalSlotCount,
      successfulRunCount: recount.succeededSlotCount,
      unavailableRunCount: recount.unavailableSlotCount,
      failedRunCount: recount.failedSlotCount,
      finalizationStatus: "FAILED",
      batchState: "EXPIRED",
    };
  }
  if (meta.admissionDeferred) {
    return {
      terminalRunCount: recount.terminalSlotCount,
      successfulRunCount: recount.succeededSlotCount,
      unavailableRunCount: recount.unavailableSlotCount,
      failedRunCount: recount.failedSlotCount,
      finalizationStatus: "PENDING",
      batchState: "ADMISSION_DEFERRED",
    };
  }
  if (recount.readyToFinalize) {
    return {
      terminalRunCount: recount.terminalSlotCount,
      successfulRunCount: recount.succeededSlotCount + recount.partialSlotCount,
      unavailableRunCount: recount.unavailableSlotCount,
      failedRunCount: recount.failedSlotCount,
      finalizationStatus: "READY_TO_FINALIZE",
      batchState: "READY_TO_FINALIZE",
    };
  }
  return {
    terminalRunCount: recount.terminalSlotCount,
    successfulRunCount: recount.succeededSlotCount + recount.partialSlotCount,
    unavailableRunCount: recount.unavailableSlotCount,
    failedRunCount: recount.failedSlotCount,
    finalizationStatus: "PENDING",
    batchState: meta.batchState === "PLANNING" ? "ANALYZING" : meta.batchState,
  };
}

function toView(batch: ScoreAnalysisBatch): EvidenceV2BatchView {
  const meta = parseMeta(batch.metadata);
  if (!meta) {
    throw new Error(`ScoreAnalysisBatch ${batch.id} is missing scoringV2 metadata`);
  }
  return { batch, meta };
}

export function createEvidenceV2BatchRepository(
  prisma: PrismaClient,
): EvidenceV2BatchRepository {
  return {
    async createBatch(input) {
      const slots: EvidenceV2SlotRecord[] = input.acquisitionPlan.slots.map((s) =>
        emptySlotRecord({
          slotId: s.slotId,
          dungeonSlug: s.dungeonSlug,
          slotIndex: s.slotIndex,
        }),
      );
      const meta: EvidenceV2BatchMetadata = {
        schemaVersion: "2.0.0",
        batchState: "PLANNING",
        acquisitionPlanContentHash: input.acquisitionPlan.contentHash,
        acquisitionPlan: input.acquisitionPlan,
        refreshGeneration: input.refreshGeneration,
        parentIngestionJobId: input.parentIngestionJobId ?? null,
        correlationId: input.correlationId ?? null,
        enabledConsumers: input.enabledConsumers,
        datasetRequirements: resolveBatchDatasetRequirements(input.enabledConsumers),
        slots,
        cancelled: false,
        cancelReason: null,
        supersededByGeneration: null,
        admissionDeferred: false,
        admissionDeferReason: null,
        manifestId: null,
        manifestContentHash: null,
        admissionReleased: false,
        publicationBlocked: true,
      };

      const existing = await prisma.scoreAnalysisBatch.findUnique({
        where: {
          characterId_seasonId_refreshId_scoreModelId: {
            characterId: input.characterId,
            seasonId: input.seasonId,
            refreshId: input.refreshId,
            scoreModelId: input.scoreModelId,
          },
        },
      });
      if (existing) {
        return toView(existing);
      }

      const batch = await prisma.scoreAnalysisBatch.create({
        data: {
          characterId: input.characterId,
          seasonId: input.seasonId,
          refreshId: input.refreshId,
          scoreModelId: input.scoreModelId,
          expectedRunCount: input.acquisitionPlan.expectedSlotCount,
          deadlineAt: input.deadlineAt ?? null,
          metadata: withMeta({}, meta),
        },
      });
      return toView(batch);
    },

    async getById(id) {
      const batch = await prisma.scoreAnalysisBatch.findUnique({ where: { id } });
      if (!batch) return null;
      const meta = parseMeta(batch.metadata);
      if (!meta) return null;
      return { batch, meta };
    },

    async claimSlot(input) {
      return prisma.$transaction(async (tx) => {
        const batch = await tx.scoreAnalysisBatch.findUnique({ where: { id: input.batchId } });
        if (!batch) return { outcome: "not_found" as const };
        const meta = parseMeta(batch.metadata);
        if (!meta) return { outcome: "not_found" as const };

        if (meta.cancelled) return { outcome: "cancelled" as const };
        if (meta.supersededByGeneration != null) return { outcome: "superseded" as const };
        if (meta.refreshGeneration !== input.refreshGeneration) {
          return { outcome: "generation_mismatch" as const };
        }

        const slot = meta.slots.find((s) => s.slotId === input.slotId);
        if (!slot) return { outcome: "not_found" as const };
        if (isEvidenceV2SlotTerminal(slot.status)) {
          return { outcome: "already_terminal" as const, view: { batch, meta } };
        }
        if (slot.status === "RUNNING") {
          return { outcome: "lost_claim" as const, view: { batch, meta } };
        }

        const nowIso = (input.now ?? new Date()).toISOString();
        const nextSlots = meta.slots.map((s) =>
          s.slotId === input.slotId
            ? {
                ...s,
                status: "RUNNING" as const,
                attempts: s.attempts + 1,
                startedAt: nowIso,
              }
            : s,
        );
        const nextMeta: EvidenceV2BatchMetadata = {
          ...meta,
          batchState: "ANALYZING",
          slots: nextSlots,
          admissionDeferred: false,
          admissionDeferReason: null,
        };
        const updated = await tx.scoreAnalysisBatch.update({
          where: { id: input.batchId },
          data: {
            metadata: withMeta(batch.metadata, nextMeta),
            finalizationStatus: "PENDING",
          },
        });
        return { outcome: "claimed" as const, view: toView(updated) };
      });
    },

    async completeSlot(input) {
      return prisma.$transaction(async (tx) => {
        const batch = await tx.scoreAnalysisBatch.findUnique({ where: { id: input.batchId } });
        if (!batch) {
          throw new Error(`V2 batch ${input.batchId} not found`);
        }
        const meta = parseMeta(batch.metadata);
        if (!meta) {
          throw new Error(`V2 batch ${input.batchId} missing metadata`);
        }
        const slot = meta.slots.find((s) => s.slotId === input.slotId);
        if (!slot) {
          throw new Error(`V2 slot ${input.slotId} not found on batch ${input.batchId}`);
        }

        const wasAlreadyTerminal = isEvidenceV2SlotTerminal(slot.status);
        if (wasAlreadyTerminal) {
          const recount = recountEvidenceV2Slots(
            meta.slots.map((s) => s.status),
            meta.acquisitionPlan.expectedSlotCount,
          );
          return {
            view: { batch, meta },
            becameReady: recount.readyToFinalize,
            wasAlreadyTerminal: true,
          };
        }

        const nowIso = (input.now ?? new Date()).toISOString();
        const nextSlots = meta.slots.map((s) =>
          s.slotId === input.slotId
            ? {
                ...s,
                status: input.status,
                finishedAt: nowIso,
                terminalReason: input.terminalReason ?? null,
                acquisitionResult: input.acquisitionResult ?? s.acquisitionResult,
                acquiredDiscoveryKey: input.acquiredDiscoveryKey ?? s.acquiredDiscoveryKey,
                datasetCompatibilityKeys:
                  input.datasetCompatibilityKeys ?? s.datasetCompatibilityKeys,
                factSetFingerprint: input.factSetFingerprint ?? s.factSetFingerprint,
                typedFactPayloads: input.typedFactPayloads ?? s.typedFactPayloads,
              }
            : s,
        );
        let nextMeta: EvidenceV2BatchMetadata = { ...meta, slots: nextSlots };
        const counts = countsToFinalization(nextMeta);
        nextMeta = { ...nextMeta, batchState: counts.batchState };
        const updated = await tx.scoreAnalysisBatch.update({
          where: { id: input.batchId },
          data: {
            metadata: withMeta(batch.metadata, nextMeta),
            terminalRunCount: counts.terminalRunCount,
            successfulRunCount: counts.successfulRunCount,
            unavailableRunCount: counts.unavailableRunCount,
            failedRunCount: counts.failedRunCount,
            finalizationStatus: counts.finalizationStatus,
          },
        });
        return {
          view: toView(updated),
          becameReady: counts.finalizationStatus === "READY_TO_FINALIZE",
          wasAlreadyTerminal: false,
        };
      });
    },

    async markAdmissionDeferred(batchId, reason) {
      const batch = await prisma.scoreAnalysisBatch.findUniqueOrThrow({ where: { id: batchId } });
      const meta = parseMeta(batch.metadata);
      if (!meta) throw new Error(`V2 batch ${batchId} missing metadata`);
      const next: EvidenceV2BatchMetadata = {
        ...meta,
        batchState: "ADMISSION_DEFERRED",
        admissionDeferred: true,
        admissionDeferReason: reason,
      };
      const updated = await prisma.scoreAnalysisBatch.update({
        where: { id: batchId },
        data: { metadata: withMeta(batch.metadata, next) },
      });
      return toView(updated);
    },

    async markAnalyzing(batchId) {
      const batch = await prisma.scoreAnalysisBatch.findUniqueOrThrow({ where: { id: batchId } });
      const meta = parseMeta(batch.metadata);
      if (!meta) throw new Error(`V2 batch ${batchId} missing metadata`);
      const next: EvidenceV2BatchMetadata = {
        ...meta,
        batchState: "ANALYZING",
        admissionDeferred: false,
        admissionDeferReason: null,
      };
      const updated = await prisma.scoreAnalysisBatch.update({
        where: { id: batchId },
        data: { metadata: withMeta(batch.metadata, next) },
      });
      return toView(updated);
    },

    async markCancelled(batchId, reason) {
      const batch = await prisma.scoreAnalysisBatch.findUniqueOrThrow({ where: { id: batchId } });
      const meta = parseMeta(batch.metadata);
      if (!meta) throw new Error(`V2 batch ${batchId} missing metadata`);
      if (meta.cancelled) return toView(batch);
      const nextSlots = meta.slots.map((s) =>
        isEvidenceV2SlotTerminal(s.status)
          ? s
          : {
              ...s,
              status: "CANCELLED" as const,
              finishedAt: new Date().toISOString(),
              terminalReason: reason,
            },
      );
      const next: EvidenceV2BatchMetadata = {
        ...meta,
        cancelled: true,
        cancelReason: reason,
        batchState: "CANCELLED",
        slots: nextSlots,
      };
      const counts = countsToFinalization(next);
      const updated = await prisma.scoreAnalysisBatch.update({
        where: { id: batchId },
        data: {
          metadata: withMeta(batch.metadata, next),
          terminalRunCount: counts.terminalRunCount,
          successfulRunCount: counts.successfulRunCount,
          unavailableRunCount: counts.unavailableRunCount,
          failedRunCount: counts.failedRunCount,
          finalizationStatus: "FAILED",
        },
      });
      return toView(updated);
    },

    async markSuperseded(batchId, byGeneration) {
      const batch = await prisma.scoreAnalysisBatch.findUniqueOrThrow({ where: { id: batchId } });
      const meta = parseMeta(batch.metadata);
      if (!meta) throw new Error(`V2 batch ${batchId} missing metadata`);
      if (meta.supersededByGeneration != null) return toView(batch);
      const nextSlots = meta.slots.map((s) =>
        isEvidenceV2SlotTerminal(s.status)
          ? s
          : {
              ...s,
              status: "SUPERSEDED" as const,
              finishedAt: new Date().toISOString(),
              terminalReason: `SUPERSEDED_BY_GENERATION_${byGeneration}`,
            },
      );
      const next: EvidenceV2BatchMetadata = {
        ...meta,
        supersededByGeneration: byGeneration,
        batchState: "EXPIRED",
        slots: nextSlots,
      };
      const counts = countsToFinalization(next);
      const updated = await prisma.scoreAnalysisBatch.update({
        where: { id: batchId },
        data: {
          metadata: withMeta(batch.metadata, next),
          terminalRunCount: counts.terminalRunCount,
          successfulRunCount: counts.successfulRunCount,
          unavailableRunCount: counts.unavailableRunCount,
          failedRunCount: counts.failedRunCount,
          finalizationStatus: "EXPIRED",
        },
      });
      return toView(updated);
    },

    async claimFinalization(batchId) {
      return prisma.$transaction(async (tx) => {
        const batch = await tx.scoreAnalysisBatch.findUnique({ where: { id: batchId } });
        if (!batch) return null;
        const meta = parseMeta(batch.metadata);
        if (!meta) return null;
        if (meta.cancelled || meta.supersededByGeneration != null) return null;
        if (
          batch.finalizationStatus !== "PENDING" &&
          batch.finalizationStatus !== "READY_TO_FINALIZE"
        ) {
          return null;
        }
        const recount = recountEvidenceV2Slots(
          meta.slots.map((s) => s.status),
          meta.acquisitionPlan.expectedSlotCount,
        );
        if (!recount.readyToFinalize) return null;

        const next: EvidenceV2BatchMetadata = { ...meta, batchState: "FINALIZING" };
        const updated = await tx.scoreAnalysisBatch.update({
          where: { id: batchId },
          data: {
            finalizationStatus: "FINALIZING",
            metadata: withMeta(batch.metadata, next),
          },
        });
        return toView(updated);
      });
    },

    async releaseFinalizationClaim(batchId) {
      return prisma.$transaction(async (tx) => {
        const batch = await tx.scoreAnalysisBatch.findUnique({ where: { id: batchId } });
        if (!batch) return null;
        const meta = parseMeta(batch.metadata);
        if (!meta) return null;
        if (batch.finalizationStatus !== "FINALIZING") {
          return toView(batch);
        }
        if (meta.cancelled || meta.supersededByGeneration != null) return null;
        const next: EvidenceV2BatchMetadata = {
          ...meta,
          batchState: "READY_TO_FINALIZE",
        };
        const updated = await tx.scoreAnalysisBatch.update({
          where: { id: batchId },
          data: {
            finalizationStatus: "READY_TO_FINALIZE",
            metadata: withMeta(batch.metadata, next),
          },
        });
        return toView(updated);
      });
    },

    async attachManifest(input) {
      const batch = await prisma.scoreAnalysisBatch.findUniqueOrThrow({
        where: { id: input.batchId },
      });
      const meta = parseMeta(batch.metadata);
      if (!meta) throw new Error(`V2 batch ${input.batchId} missing metadata`);
      const next: EvidenceV2BatchMetadata = {
        ...meta,
        manifestId: input.manifestId,
        manifestContentHash: input.manifestContentHash,
        batchState: "MANIFEST_READY",
      };
      const updated = await prisma.scoreAnalysisBatch.update({
        where: { id: input.batchId },
        data: {
          evidenceManifestId: input.manifestId,
          metadata: withMeta(batch.metadata, next),
        },
      });
      return toView(updated);
    },

    async markFinalized(batchId) {
      const batch = await prisma.scoreAnalysisBatch.findUniqueOrThrow({ where: { id: batchId } });
      const meta = parseMeta(batch.metadata);
      if (!meta) throw new Error(`V2 batch ${batchId} missing metadata`);
      if (batch.finalizationStatus === "FINALIZED") return toView(batch);
      const next: EvidenceV2BatchMetadata = { ...meta, batchState: "FINALIZED" };
      const updated = await prisma.scoreAnalysisBatch.update({
        where: { id: batchId },
        data: {
          finalizationStatus: "FINALIZED",
          finalizedAt: new Date(),
          metadata: withMeta(batch.metadata, next),
        },
      });
      return toView(updated);
    },

    async markFailed(batchId, reason) {
      const batch = await prisma.scoreAnalysisBatch.findUniqueOrThrow({ where: { id: batchId } });
      const meta = parseMeta(batch.metadata);
      if (!meta) throw new Error(`V2 batch ${batchId} missing metadata`);
      const next: EvidenceV2BatchMetadata = {
        ...meta,
        batchState: "FAILED",
        cancelReason: reason,
      };
      const updated = await prisma.scoreAnalysisBatch.update({
        where: { id: batchId },
        data: {
          finalizationStatus: "FAILED",
          metadata: withMeta(batch.metadata, next),
        },
      });
      return toView(updated);
    },

    async markAdmissionReleased(batchId) {
      const batch = await prisma.scoreAnalysisBatch.findUniqueOrThrow({ where: { id: batchId } });
      const meta = parseMeta(batch.metadata);
      if (!meta) throw new Error(`V2 batch ${batchId} missing metadata`);
      if (meta.admissionReleased) return toView(batch);
      const next: EvidenceV2BatchMetadata = { ...meta, admissionReleased: true };
      const updated = await prisma.scoreAnalysisBatch.update({
        where: { id: batchId },
        data: { metadata: withMeta(batch.metadata, next) },
      });
      return toView(updated);
    },
  };
}
