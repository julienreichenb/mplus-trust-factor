import { z } from "zod";
import type { IsoDateTime, RegionCode } from "./identity.js";

export const QUEUE_NAMES = {
  refreshCharacter: "refresh-character",
  analyzeRun: "analyze-run",
  recalculateScore: "recalculate-score",
  generateAddonExport: "generate-addon-export",
  syncRealmCatalog: "sync-realm-catalog",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

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
});

export type RefreshCharacterJob = z.infer<typeof refreshCharacterJobSchema> & {
  region: RegionCode;
};

export const analyzeRunJobSchema = z.object({
  runId: z.string().uuid(),
  characterId: z.string().uuid(),
  selectionKind: z.enum(["LATEST", "HIGHEST"]),
  analysisVersion: z.string().min(1),
  requestedAt: z.string().datetime(),
});

export type AnalyzeRunJob = z.infer<typeof analyzeRunJobSchema>;

export const recalculateScoreJobSchema = z.object({
  characterId: z.string().uuid(),
  seasonId: z.string().uuid(),
  scoreModelKey: z.string().min(1),
  scoreModelVersion: z.number().int().positive(),
  requestedAt: z.string().datetime(),
});

export type RecalculateScoreJob = z.infer<typeof recalculateScoreJobSchema>;

export const generateAddonExportJobSchema = z.object({
  region: z.string().min(1),
  seasonId: z.string().uuid(),
  scoreModelKey: z.string().min(1),
  scoreModelVersion: z.number().int().positive(),
  requestedAt: z.string().datetime(),
});

export type GenerateAddonExportJob = z.infer<typeof generateAddonExportJobSchema>;

export const syncRealmCatalogJobSchema = z.object({
  /** When omitted, sync all enabled retail regions (EU/US/KR/TW). */
  regions: z.array(z.string().min(1).max(8)).optional(),
  /** When true, re-fetch realm details even if the slug already exists. */
  forceDetails: z.boolean().default(false),
  requestedAt: z.string().datetime(),
  correlationId: z.string().min(1).max(128).nullable().optional(),
});

export type SyncRealmCatalogJob = z.infer<typeof syncRealmCatalogJobSchema>;

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
