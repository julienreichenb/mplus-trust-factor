import type {
  EvidenceAcquisitionPlanV2,
  EvidenceCandidateAcquisitionResult,
  EvidenceV2BatchState,
  EvidenceV2EnabledConsumer,
  EvidenceV2SlotJobStatus,
} from "@mplus/contracts";
import type { EvidenceDatasetRequirementV2 } from "./dataset-requirements.js";
import type { AcquiredEvidenceDatasetDescriptor } from "./dataset-descriptor-persist.js";
import type { ScoringProviderAccounting } from "./provider-accounting.js";
import type { TypedDimensionFactPayload } from "./typed-fact-persist.js";

export const scoring_BATCH_METADATA_KEY = "scoring" as const;

export const scoring_FACT_EXTRACTOR_FAMILY = "evidence-v2-shadow" as const;
export const scoring_FACT_EXTRACTOR_VERSION = "0.1.0" as const;
export const scoring_FACT_SCHEMA_VERSION = "2.0.0" as const;
export const scoring_DATASET_SCHEMA_VERSION = "2.0.0" as const;

export type { AcquiredEvidenceDatasetDescriptor };

export interface EvidenceV2SlotRecord {
  slotId: string;
  dungeonSlug: string;
  slotIndex: 0 | 1;
  status: EvidenceV2SlotJobStatus;
  attempts: number;
  startedAt: string | null;
  finishedAt: string | null;
  terminalReason: string | null;
  /** Winning discovery identity key when acquired. */
  acquiredDiscoveryKey: string | null;
  /**
   * In-flight reportCode:fightId reservation while this slot is RUNNING.
   * Prevents a parallel sibling from acquiring the same identity.
   */
  reservedDiscoveryKey: string | null;
  acquisitionResult: EvidenceCandidateAcquisitionResult | null;
  /**
   * Ordered per-attempt rejections for this slot's fallback chain.
   * Retained so FALLBACK_EXHAUSTED does not erase candidate-level reasons.
   */
  rejectedAttempts: EvidenceCandidateAcquisitionResult[];
  /** Persisted dataset / fact fingerprints for resumability. */
  datasetCompatibilityKeys: string[];
  /**
   * Bounded durable dataset descriptors for post-freeze EvidenceDataset writes.
   * Captured during acquisition when manifestSlotId is not yet known.
   */
  datasetDescriptors: AcquiredEvidenceDatasetDescriptor[];
  factSetFingerprint: string | null;
  /**
   * Typed dimension fact payloads extracted during acquisition.
   * Persisted to RunFactSet after manifest freeze (provider-free).
   */
  typedFactPayloads: TypedDimensionFactPayload[];
  /** Per-slot WCL provider/cache counters for Shadow Canary diagnostics. */
  providerAccounting: ScoringProviderAccounting | null;
}

export interface EvidenceV2BatchMetadata {
  schemaVersion: "2.0.0";
  batchState: EvidenceV2BatchState;
  acquisitionPlanContentHash: string;
  acquisitionPlan: EvidenceAcquisitionPlanV2;
  refreshGeneration: number;
  parentIngestionJobId: string | null;
  correlationId: string | null;
  enabledConsumers: EvidenceV2EnabledConsumer[];
  /**
   * Immutable dataset requirement list derived from enabledConsumers at batch create.
   * Acquisition must not request datasets outside this plan.
   */
  datasetRequirements: EvidenceDatasetRequirementV2[];
  slots: EvidenceV2SlotRecord[];
  cancelled: boolean;
  cancelReason: string | null;
  supersededByGeneration: number | null;
  admissionDeferred: boolean;
  admissionDeferReason: string | null;
  /** Set after EvidenceManifestV2 freeze. */
  manifestId: string | null;
  manifestContentHash: string | null;
  /** Idempotent admission release marker. */
  admissionReleased: boolean;
  publicationBlocked: true;
  /**
   * Admin Shadow Canary batches may run while global scoring_* flags stay off.
   * Publication remains blocked regardless.
   */
  adminShadowCanary?: boolean;
  /** Optional link back to ScoringShadowCanary.id */
  shadowCanaryId?: string | null;
}

export function emptySlotRecord(
  slot: Pick<EvidenceV2SlotRecord, "slotId" | "dungeonSlug" | "slotIndex">,
): EvidenceV2SlotRecord {
  return {
    slotId: slot.slotId,
    dungeonSlug: slot.dungeonSlug,
    slotIndex: slot.slotIndex,
    status: "PENDING",
    attempts: 0,
    startedAt: null,
    finishedAt: null,
    terminalReason: null,
    acquiredDiscoveryKey: null,
    reservedDiscoveryKey: null,
    acquisitionResult: null,
    rejectedAttempts: [],
    datasetCompatibilityKeys: [],
    datasetDescriptors: [],
    factSetFingerprint: null,
    typedFactPayloads: [],
    providerAccounting: null,
  };
}
