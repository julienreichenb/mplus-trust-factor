import type {
  EvidenceAcquisitionPlanV2,
  EvidenceCandidateAcquisitionResult,
  EvidenceV2BatchState,
  EvidenceV2EnabledConsumer,
  EvidenceV2SlotJobStatus,
} from "@mplus/contracts";

export const SCORING_V2_BATCH_METADATA_KEY = "scoringV2" as const;

export const SCORING_V2_FACT_EXTRACTOR_FAMILY = "evidence-v2-shadow" as const;
export const SCORING_V2_FACT_EXTRACTOR_VERSION = "0.1.0" as const;
export const SCORING_V2_FACT_SCHEMA_VERSION = "2.0.0" as const;
export const SCORING_V2_DATASET_SCHEMA_VERSION = "2.0.0" as const;

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
  acquisitionResult: EvidenceCandidateAcquisitionResult | null;
  /** Persisted dataset / fact fingerprints for resumability. */
  datasetCompatibilityKeys: string[];
  factSetFingerprint: string | null;
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
    acquisitionResult: null,
    datasetCompatibilityKeys: [],
    factSetFingerprint: null,
  };
}
