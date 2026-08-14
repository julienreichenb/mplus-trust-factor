import { z } from "zod";
import type { IsoDateTime, RegionCode } from "./identity.js";

export const QUEUE_NAMES = {
  refreshCharacter: "refresh-character",
  analyzeRun: "analyze-run",
  recalculateScore: "recalculate-score",
  finalizeScore: "finalize-score",
  generateAddonExport: "generate-addon-export",
  syncRealmCatalog: "sync-realm-catalog",
  discoverOwnedCharacters: "discover-owned-characters",
  bulkCharacterProcessing: "bulk-character-processing",
  /**
   * Dedicated calibration execution queue — not an IngestionJob / refresh-character job.
   * Must never affect refresh admission, concurrency, ETA, throughput, or priority.
   */
  calibrationRun: "calibration-run",
  /**
   * Scoring V2 — one job per EvidenceAcquisitionPlanV2 slot (provider-aware acquisition).
   * Isolated from calibration-run; versioned payloads.
   */
  analyzeEvidenceSlot: "analyze-evidence-slot",
  /**
   * Scoring V2 — fan-in after all expected slots are terminal.
   * Provider-free finalization (manifest freeze + dimension placeholder).
   */
  finalizeAnalysisBatch: "finalize-analysis-batch",
  /**
   * Calibration-initiated character refresh lane — shares refresh processor,
   * isolated BullMQ queue + Redis lane permits from OPERATION traffic.
   */
  refreshCharacterCalibration: "refresh-character-calibration",
  /**
   * Admin Scoring V2 evidence-join export — provider-free, no refresh enqueue.
   */
  ScoringEvidenceExport: "scoring-evidence-export",
  /**
   * Admin Shadow Canary — bounded single-character Scoring V2 SHADOW run.
   * Does not require global scoring_* flags; publication remains blocked.
   */
  ScoringShadowCanary: "scoring-shadow-canary",
  /**
   * Admin Key-context Raider.IO addon median-key distribution ingest.
   * Isolated from character refresh / scoring providers.
   */
  keyDistributionRefresh: "key-distribution-refresh",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/** Why a refresh-character job was enqueued. Optional for backward-compatible persisted jobs. */
export const refreshTriggerSourceSchema = z.enum([
  "PROFILE_READ",
  "MANUAL_REFRESH",
  "MANUAL_FORCE_REFRESH",
  "ACCOUNT_DISCOVERY",
  "BULK_REFRESH",
  "SYSTEM",
  "UNKNOWN",
]);

export type RefreshTriggerSource = z.infer<typeof refreshTriggerSourceSchema>;

export const refreshCharacterJobSchema = z.object({
  characterId: z.string().uuid().optional(),
  region: z.string().min(1).max(8),
  realmSlug: z.string().min(1).max(64),
  name: z.string().min(1).max(48),
  priority: z.enum(["high", "normal", "low"]).default("normal"),
  forceRefresh: z.boolean().default(false),
  requestedAt: z.string().datetime(),
  /** API request id propagated API → queue → worker for log correlation. */
  correlationId: z.string().min(1).max(128).nullable().optional(),
  /**
   * Hash of the active RefreshContractVersions at enqueue time.
   * Model/adapter/schema bumps must not reuse jobs keyed under an older contract.
   * Mandatory for newly enqueued production/live jobs; optional only for legacy
   * fixture/test payloads (worker fail-closed when PROVIDER_MODE=live).
   */
  refreshContractHash: z.string().min(1).max(128).optional(),
  /**
   * Exact scoring model identity at enqueue time. Optional additive fields for
   * admin display — never inferred later from the currently active model.
   */
  scoringModelKey: z.string().min(1).max(64).optional(),
  scoringModelVersion: z.number().int().positive().optional(),
  /** Optional enqueue boundary label; absent on older persisted jobs. */
  triggerSource: refreshTriggerSourceSchema.optional(),
  /**
   * Immutable regional season identity attached at enqueue from verified Blizzard authority.
   * Optional for backward-compatible persisted jobs.
   */
  authoritativeSeasonId: z.number().int().positive().optional(),
  authoritativeSeasonSlug: z.string().min(1).max(64).optional(),
  authoritySource: z.string().min(1).max(64).optional(),
  /**
   * Explicit workload lane. Default OPERATION when absent (legacy jobs).
   * Never infer from character name or caller text.
   */
  workloadClass: z.enum(["CALIBRATION", "OPERATION"]).optional(),
});

export type RefreshCharacterJob = z.infer<typeof refreshCharacterJobSchema> & {
  region: RegionCode;
};

export const analyzeRunJobSchema = z.object({
  runId: z.string().uuid(),
  characterId: z.string().uuid(),
  selectionKind: z.enum(["LATEST", "HIGHEST", "SELECTED"]),
  analysisVersion: z.string().min(1),
  requestedAt: z.string().datetime(),
  /** Durable fan-in batch this child belongs to. */
  analysisBatchId: z.string().uuid().optional(),
  refreshId: z.string().uuid().optional(),
});

export type AnalyzeRunJob = z.infer<typeof analyzeRunJobSchema>;

export const recalculateScoreJobSchema = z.object({
  characterId: z.string().uuid(),
  seasonId: z.string().uuid(),
  scoreModelKey: z.string().min(1),
  scoreModelVersion: z.number().int().positive(),
  requestedAt: z.string().datetime(),
  /** When set, only publish when this batch is terminal / ready. */
  analysisBatchId: z.string().uuid().optional(),
  /** When true, treat as fan-in finalization (idempotent publish). */
  finalize: z.boolean().optional(),
});

export type RecalculateScoreJob = z.infer<typeof recalculateScoreJobSchema>;

export const finalizeScoreJobSchema = z.object({
  analysisBatchId: z.string().uuid(),
  characterId: z.string().uuid(),
  seasonId: z.string().uuid(),
  scoreModelKey: z.string().min(1),
  scoreModelVersion: z.number().int().positive(),
  refreshId: z.string().uuid(),
  requestedAt: z.string().datetime(),
  /** Deadline finalization may run even if some children are still RUNNING. */
  forceDeadline: z.boolean().optional(),
});

export type FinalizeScoreJob = z.infer<typeof finalizeScoreJobSchema>;

export const generateAddonExportJobSchema = z.object({
  region: z.string().min(1),
  seasonId: z.string().uuid(),
  scoreModelKey: z.string().min(1),
  scoreModelVersion: z.number().int().positive(),
  requestedAt: z.string().datetime(),
});

export type GenerateAddonExportJob = z.infer<typeof generateAddonExportJobSchema>;

export type AnalysisRunTerminalStatus = "SUCCEEDED" | "UNAVAILABLE" | "FAILED";
export type AnalysisRunStatus = "PENDING" | "RUNNING" | AnalysisRunTerminalStatus;
export type FinalizationStatus =
  | "PENDING"
  | "READY_TO_FINALIZE"
  | "FINALIZING"
  | "FINALIZED"
  | "FAILED"
  | "EXPIRED";

/** Scoring V2 analysis-batch lifecycle (shadow orchestration). */
export const evidenceV2BatchStateSchema = z.enum([
  "PLANNING",
  "MANIFEST_READY",
  "ADMISSION_DEFERRED",
  "FETCHING",
  "ANALYZING",
  "READY_TO_FINALIZE",
  "FINALIZING",
  "FINALIZED",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
]);
export type EvidenceV2BatchState = z.infer<typeof evidenceV2BatchStateSchema>;

/** Per-slot job status for V2 fan-out (broader than V1 AnalysisRunJobStatus). */
export const evidenceV2SlotJobStatusSchema = z.enum([
  "PENDING",
  "RUNNING",
  "SUCCEEDED",
  "PARTIAL",
  "UNAVAILABLE",
  "FAILED",
  "CANCELLED",
  "SUPERSEDED",
]);
export type EvidenceV2SlotJobStatus = z.infer<typeof evidenceV2SlotJobStatusSchema>;

export const evidenceV2EnabledConsumerSchema = z.enum([
  "PERFORMANCE",
  "SURVIVAL",
  "UTILITY",
]);
export type EvidenceV2EnabledConsumer = z.infer<typeof evidenceV2EnabledConsumerSchema>;

/**
 * Analyze one EvidenceAcquisitionPlanV2 slot (provider-aware, with fallbacks).
 * Carries plan hash — EvidenceManifestV2 is created only after acquisition + fan-in.
 */
export const analyzeEvidenceSlotJobV2Schema = z.object({
  schemaVersion: z.literal("2.0.0").default("2.0.0"),
  analysisBatchId: z.string().uuid(),
  acquisitionPlanContentHash: z.string().min(1).max(128),
  slotId: z.string().min(1).max(128),
  /** Present only after manifest freeze (post-finalize redelivery paths). */
  manifestId: z.string().uuid().optional(),
  expectedManifestHash: z.string().min(1).max(128).optional(),
  expectedReportRevision: z.number().int().nonnegative().nullable().optional(),
  enabledConsumers: z.array(evidenceV2EnabledConsumerSchema).min(1),
  refreshGeneration: z.number().int().nonnegative(),
  requestedAt: z.string().datetime(),
  correlationId: z.string().min(1).max(128).nullable().optional(),
});
export type AnalyzeEvidenceSlotJobV2 = z.infer<typeof analyzeEvidenceSlotJobV2Schema>;

/**
 * Fan-in: freeze EvidenceManifestV2 from acquisition results, run provider-free
 * dimension aggregation placeholder. Must never mutate the public score pointer.
 */
export const finalizeEvidenceBatchJobV2Schema = z.object({
  schemaVersion: z.literal("2.0.0").default("2.0.0"),
  analysisBatchId: z.string().uuid(),
  acquisitionPlanContentHash: z.string().min(1).max(128),
  expectedTerminalSlotCount: z.number().int().nonnegative(),
  refreshGeneration: z.number().int().nonnegative(),
  requestedAt: z.string().datetime(),
  correlationId: z.string().min(1).max(128).nullable().optional(),
});
export type FinalizeEvidenceBatchJobV2 = z.infer<typeof finalizeEvidenceBatchJobV2Schema>;

export const syncRealmCatalogJobSchema = z.object({
  /** When omitted, sync all enabled retail regions (EU/US/KR/TW). */
  regions: z.array(z.string().min(1).max(8)).optional(),
  /** When true, re-fetch realm details even if the slug already exists. */
  forceDetails: z.boolean().default(false),
  requestedAt: z.string().datetime(),
  correlationId: z.string().min(1).max(128).nullable().optional(),
});

export type SyncRealmCatalogJob = z.infer<typeof syncRealmCatalogJobSchema>;

export const discoverOwnedCharactersJobSchema = z.object({
  battleNetAccountId: z.string().uuid(),
  userId: z.string().uuid(),
  /** ISO timestamp of the ownership sync revision this discovery evaluates. */
  ownershipSyncAt: z.string().datetime(),
  /** Active season slug / id key used for dedupe with ownership sync revision. */
  seasonKey: z.string().min(1).max(64),
  requestedAt: z.string().datetime(),
  correlationId: z.string().min(1).max(128).nullable().optional(),
});

export type DiscoverOwnedCharactersJob = z.infer<typeof discoverOwnedCharactersJobSchema>;

/** Mass refresh vs model-only recalculation for the bulk orchestrator. */
export const bulkModeSchema = z.enum(["FULL_REFRESH", "RECALCULATE_ONLY"]);
export type BulkMode = z.infer<typeof bulkModeSchema>;

/** Max explicit character IDs accepted on a bulk operation. */
export const BULK_EXPLICIT_CHARACTER_IDS_MAX = 500;

/** Deduplicate UUIDs while preserving first-seen (picker) order. */
export function dedupeCharacterIdsPreservingOrder(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * Admin / Agent-08 input for creating a bulk character processing operation.
 * `minMythicPlusScore = null` selects every persisted character (cohort mode).
 * Non-empty `characterIds` selects exactly those characters (explicit mode).
 */
export const bulkCharacterProcessingInputSchema = z
  .object({
    mode: bulkModeSchema,
    minMythicPlusScore: z.number().finite().nullable(),
    scoreModelId: z.string().uuid().nullable().optional(),
    batchSize: z.number().int().positive().max(500).default(25),
    maxCharacters: z.number().int().positive().nullable().optional(),
    maxWclCalls: z.number().int().positive().nullable().optional(),
    dryRun: z.boolean().default(false),
    /**
     * When false (default), incompatible RECALCULATE_ONLY evidence is reported and skipped.
     * When true, those items may enqueue FULL_REFRESH instead.
     */
    allowFullRefreshOnIncompatible: z.boolean().default(false),
    /** Dedupes concurrent active operations; defaults to a stable mode/threshold/model key. */
    logicalKey: z.string().min(1).max(200).optional(),
    /**
     * Explicit persisted character UUIDs. Null = cohort mode.
     * Non-empty array = explicit mode. Empty arrays are rejected.
     * Must not be combined with minMythicPlusScore or maxCharacters.
     */
    characterIds: z.array(z.string().uuid()).max(BULK_EXPLICIT_CHARACTER_IDS_MAX).nullable().optional(),
    /**
     * When set, RECALCULATE_ONLY child jobs score this season even if the
     * global effective scoring season changes before execution.
     */
    pinnedSeasonId: z.string().uuid().optional(),
  })
  .superRefine((data, ctx) => {
    if (Array.isArray(data.characterIds) && data.characterIds.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["characterIds"],
        message: "characterIds must be null (cohort) or a non-empty array (explicit selection)",
      });
      return;
    }
    const explicit =
      data.characterIds != null &&
      dedupeCharacterIdsPreservingOrder(data.characterIds).length > 0;
    if (!explicit) return;
    if (data.minMythicPlusScore !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["minMythicPlusScore"],
        message:
          "minMythicPlusScore must be null when characterIds are provided (explicit selection mode)",
      });
    }
    if (data.maxCharacters != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxCharacters"],
        message:
          "maxCharacters must be null when characterIds are provided (explicit selection mode)",
      });
    }
  })
  .transform((data) => ({
    ...data,
    characterIds:
      data.characterIds == null || data.characterIds.length === 0
        ? null
        : dedupeCharacterIdsPreservingOrder(data.characterIds),
  }));

export type BulkCharacterProcessingInput = z.infer<typeof bulkCharacterProcessingInputSchema>;

export function isExplicitBulkCharacterSelection(
  input: Pick<BulkCharacterProcessingInput, "characterIds">,
): boolean {
  return input.characterIds != null && input.characterIds.length > 0;
}

/** Parent tick job — resumes from persisted operation checkpoint. */
export const bulkOrchestratorJobSchema = z.object({
  bulkOperationId: z.string().uuid(),
  requestedAt: z.string().datetime(),
  correlationId: z.string().min(1).max(128).nullable().optional(),
});

export type BulkOrchestratorJob = z.infer<typeof bulkOrchestratorJobSchema>;

export type JobStatus = "queued" | "active" | "completed" | "failed" | "cancelled" | "delayed" | "unknown";

/** Approximate wait-estimate confidence (Stage 4 refresh ETA read model). */
export type EstimateConfidence = "LOW" | "MEDIUM" | "HIGH";

/**
 * Global refresh scheduling state mirrored from Redis admission.
 * See doc/architecture/parallel-refresh-scheduling.md §12.
 */
export type RefreshSchedulingState =
  | "RUNNING"
  | "PAUSED"
  | "RATE_LIMITED"
  | "CIRCUIT_OPEN"
  | "DRAINING";

/**
 * Additive scheduling / ETA fields on job status (nullable when unavailable).
 * Populated only when REFRESH_ETA_ENABLED=true; omitted or null when disabled.
 */
export interface RefreshEtaFields {
  /** Admitted refresh pipelines holding a global slot (or ACTIVE count fallback). */
  activeRefreshCount: number | null;
  /** Free global slots under healthy scheduling (not activeRefreshCount alone). */
  effectiveWorkerCapacity: number | null;
  /** Completions per second from a bounded recent window (null when insufficient). */
  observedThroughput: number | null;
  /** Approximate eligible jobs ahead under DB priority then scheduledAt. */
  queuePosition: number | null;
  /** Coarse bucketed wait in seconds; null when estimate is unavailable. */
  estimatedWaitSeconds: number | null;
  estimateConfidence: EstimateConfidence | null;
  schedulingState: RefreshSchedulingState | null;
}

export const keyDistributionRefreshJobSchema = z.object({
  refreshId: z.string().uuid(),
  seasonId: z.string().uuid(),
  region: z.enum(["EU"]),
  requestedAt: z.string().datetime(),
  correlationId: z.string().min(1).max(128).nullable().optional(),
});
export type KeyDistributionRefreshJob = z.infer<typeof keyDistributionRefreshJobSchema>;

export interface JobStatusDTO extends Partial<RefreshEtaFields> {
  jobId: string;
  queue: QueueName;
  status: JobStatus;
  dedupeKey: string | null;
  createdAt: IsoDateTime;
  startedAt: IsoDateTime | null;
  finishedAt: IsoDateTime | null;
  errorMessage: string | null;
}
