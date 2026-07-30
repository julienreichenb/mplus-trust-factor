import type { IsoDateTime } from "./identity.js";
import type { BulkMode } from "./jobs.js";

export type BulkOperationStatus =
  | "PENDING"
  | "SELECTING"
  | "RUNNING"
  | "PAUSED"
  | "CANCELLED"
  | "COMPLETED"
  | "FAILED"
  | "DRY_RUN_COMPLETED";

export type BulkOperationItemStatus =
  | "PENDING"
  | "ENQUEUED"
  | "SKIPPED_INCOMPATIBLE"
  | "SKIPPED_BUDGET"
  | "SKIPPED_CANCELLED"
  | "SKIPPED_DRY_RUN"
  | "SKIPPED_CHARACTER_DELETED";

/**
 * Operation status COMPLETED means every selected item was either dispatched to a
 * child queue or skipped — not that child refresh/recalculate jobs finished successfully.
 */
export type BulkCompletionSemantics = "CHILD_DISPATCH_FINISHED";

export interface BulkOperationProgressDTO {
  selectedCount: number;
  skippedCount: number;
  /** Items whose child job was successfully accepted by enqueue (including dedupe reuse). */
  dispatchedCount: number;
  /** Child jobs newly published (excludes pure active-job reuse). */
  enqueuedCount: number;
  /** Reserved for terminal dispatch accounting; failed attempts stay PENDING/retryable. */
  dispatchFailedCount: number;
  estimatedWclCalls: number | null;
  consumedWclCalls: number | null;
  /** Highest successfully dispatched item position + 1 (progress cursor; not a skip fence). */
  cursor: number;
}

export interface BulkOperationDTO {
  id: string;
  mode: BulkMode;
  status: BulkOperationStatus;
  /**
   * When status is COMPLETED, this is always CHILD_DISPATCH_FINISHED —
   * child processing outcomes are not tracked by the bulk orchestrator.
   */
  completionSemantics: BulkCompletionSemantics;
  /** Always false for this orchestrator — do not treat COMPLETED as score/publish success. */
  childOutcomesTracked: false;
  logicalKey: string;
  minMythicPlusScore: number | null;
  scoreModelId: string | null;
  batchSize: number;
  maxCharacters: number | null;
  maxWclCalls: number | null;
  dryRun: boolean;
  allowFullRefreshOnIncompatible: boolean;
  selectionFingerprint: string | null;
  progress: BulkOperationProgressDTO;
  createdByUserId: string | null;
  cancelRequestedAt: IsoDateTime | null;
  pauseRequestedAt: IsoDateTime | null;
  errorMessage: string | null;
  startedAt: IsoDateTime | null;
  completedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface BulkOperationItemDTO {
  id: string;
  bulkOperationId: string;
  characterId: string | null;
  position: number;
  status: BulkOperationItemStatus;
  region: string;
  realmSlug: string;
  characterName: string;
  mythicPlusScore: number | null;
  evidenceCompatible: boolean | null;
  skipReason: string | null;
  errorMessage: string | null;
  /** IngestionJob.id (UUID) of the dispatched child — not the BullMQ execution id. */
  childJobId: string | null;
  childJobType: string | null;
  processedAt: IsoDateTime | null;
}

export interface BulkOperationDetailDTO extends BulkOperationDTO {
  items: BulkOperationItemDTO[];
}

export interface BulkDryRunEstimateDTO {
  selectedCount: number;
  estimatedChildJobs: number;
  estimatedWclCalls: number;
  selectionFingerprint: string;
}
