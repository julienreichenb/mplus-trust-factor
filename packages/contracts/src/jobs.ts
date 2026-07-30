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
   */
  refreshContractHash: z.string().min(1).max(128).optional(),
  /** Optional enqueue boundary label; absent on older persisted jobs. */
  triggerSource: refreshTriggerSourceSchema.optional(),
  /**
   * Immutable regional season identity attached at enqueue from verified Blizzard authority.
   * Optional for backward-compatible persisted jobs.
   */
  authoritativeSeasonId: z.number().int().positive().optional(),
  authoritativeSeasonSlug: z.string().min(1).max(64).optional(),
  authoritySource: z.string().min(1).max(64).optional(),
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

export type JobStatus = "queued" | "active" | "completed" | "failed" | "delayed" | "unknown";

export interface JobStatusDTO {
  jobId: string;
  queue: QueueName;
  status: JobStatus;
  dedupeKey: string | null;
  createdAt: IsoDateTime;
  startedAt: IsoDateTime | null;
  finishedAt: IsoDateTime | null;
  errorMessage: string | null;
}
