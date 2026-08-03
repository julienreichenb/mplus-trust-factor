/**
 * Scoring V2 Control Center contracts — overview, evidence export, concurrency, history.
 * Admin-only. No secrets, provider tokens, or database URLs.
 */
import { z } from "zod";

export const REFRESH_WORKLOAD_CLASSES = ["CALIBRATION", "OPERATION"] as const;
export type RefreshWorkloadClass = (typeof REFRESH_WORKLOAD_CLASSES)[number];

export const refreshWorkloadClassSchema = z.enum(REFRESH_WORKLOAD_CLASSES);

export const SCORING_V2_EVIDENCE_EXPORT_STATUSES = [
  "QUEUED",
  "RUNNING",
  "RETRYABLE",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;
export type ScoringV2EvidenceExportStatus = (typeof SCORING_V2_EVIDENCE_EXPORT_STATUSES)[number];

export const scoringV2EvidenceExportStatusSchema = z.enum(SCORING_V2_EVIDENCE_EXPORT_STATUSES);

/** Typed runtime setting keys for refresh lane concurrency. */
export const RUNTIME_SETTING_KEYS = {
  concurrencyCalibration: "concurrency_calibration",
  concurrencyOperation: "concurrency_operation",
} as const;

export const CONCURRENCY_MIN = 1;
export const CONCURRENCY_MAX = 8;
export const DEFAULT_CONCURRENCY_CALIBRATION = 4;
export const DEFAULT_CONCURRENCY_OPERATION = 2;

export const concurrencyValueSchema = z
  .number()
  .int()
  .min(CONCURRENCY_MIN)
  .max(CONCURRENCY_MAX);

export const EVIDENCE_JOIN_PREFLIGHT_SCHEMA_VERSION = "scoring-v2-evidence-join-preflight-v1" as const;

export const scoringV2ModeLabelSchema = z.enum(["Disabled", "Shadow", "Candidate", "Active"]);
export type ScoringV2ModeLabel = z.infer<typeof scoringV2ModeLabelSchema>;

export const scoringV2IssueSeveritySchema = z.enum(["blocker", "warning", "info"]);
export type ScoringV2IssueSeverity = z.infer<typeof scoringV2IssueSeveritySchema>;

export const scoringV2IssueSchema = z.object({
  code: z.string().min(1).max(128),
  severity: scoringV2IssueSeveritySchema,
  message: z.string().min(1).max(512),
  memberId: z.string().max(128).nullable().optional(),
});
export type ScoringV2IssueDTO = z.infer<typeof scoringV2IssueSchema>;

export const createEvidenceExportBodySchema = z.object({
  cohortId: z.string().uuid(),
  /** When omitted, uses the cohort's current revision (still frozen into the export row). */
  cohortRevision: z.number().int().positive().optional(),
  seasonId: z.string().uuid().optional(),
});
export type CreateEvidenceExportBody = z.infer<typeof createEvidenceExportBodySchema>;

export const updateConcurrencyBodySchema = z.object({
  concurrencyCalibration: concurrencyValueSchema.optional(),
  concurrencyOperation: concurrencyValueSchema.optional(),
  /** Optimistic concurrency — must match current settings version. */
  expectedVersion: z.number().int().positive(),
});
export type UpdateConcurrencyBody = z.infer<typeof updateConcurrencyBodySchema>;

export const freezeEvidenceBundleBodySchema = z.object({
  /** Explicit confirmation required. */
  confirm: z.literal(true),
  /** Optional DRAFT/evaluation model — frozen only when explicitly selected. */
  evaluationModelId: z.string().uuid().optional().nullable(),
});
export type FreezeEvidenceBundleBody = z.infer<typeof freezeEvidenceBundleBodySchema>;

export const scoringV2EvidenceExportJobSchema = z.object({
  exportId: z.string().uuid(),
  requestedAt: z.string().datetime(),
  correlationId: z.string().min(1).max(128).nullable().optional(),
});
export type ScoringV2EvidenceExportJob = z.infer<typeof scoringV2EvidenceExportJobSchema>;

export interface ScoringV2FlagOverviewDTO {
  masterEnabled: boolean;
  selectionEnabled: boolean;
  evidenceFetchEnabled: boolean;
  dimensionsEnabled: boolean;
  publicationEnabled: boolean;
  calibrationV2Enabled: boolean;
  adminCalibrationEnabled: boolean;
  performanceEnabled: boolean;
  survivalEnabled: boolean;
  utilityEnabled: boolean;
  experienceEnabled: boolean;
  relativeDamageMode: "off" | "shadow" | "active";
  utilityOpportunityMode: "off" | "shadow" | "active";
  referenceComparisonMode: "off" | "collect" | "shadow" | "active";
  /** Derived operational label for the control center. */
  modeLabel: ScoringV2ModeLabel;
  incompatibleReasons: string[];
}

export interface ScoringV2ModelSummaryDTO {
  id: string;
  key: string;
  version: number;
  name: string;
  status: string;
}

export interface ScoringV2SeasonSummaryDTO {
  id: string;
  slug: string;
  name: string;
  isCurrent: boolean;
  blizzardSeasonId: number | null;
}

export interface ScoringV2QueueCountsDTO {
  workloadClass: RefreshWorkloadClass | "CALIBRATION_RUN" | "EVIDENCE_EXPORT" | "OTHER";
  queued: number;
  active: number;
}

export interface ScoringV2EvidenceExportSummaryDTO {
  id: string;
  cohortId: string;
  cohortName: string | null;
  cohortRevision: number;
  seasonId: string | null;
  status: ScoringV2EvidenceExportStatus;
  blockerCount: number;
  warningCount: number;
  archiveContentHash: string | null;
  frozenBundleContentHash: string | null;
  frozenAt: string | null;
  requestedByUserId: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface ScoringV2ConcurrencyLaneDTO {
  workloadClass: RefreshWorkloadClass;
  configured: number;
  effective: number;
  active: number;
  queued: number;
  version: number;
  updatedAt: string | null;
  updatedByUserId: string | null;
}

/** Evidence-based concurrency settings sync across worker replicas. */
export const SCORING_V2_CONCURRENCY_SYNC_STATES = [
  "SYNCHRONIZED",
  "PARTIALLY_OBSERVED",
  "STALE",
  "UNSYNCHRONIZED",
  "UNKNOWN",
] as const;
export type ScoringV2ConcurrencySyncState = (typeof SCORING_V2_CONCURRENCY_SYNC_STATES)[number];
export const scoringV2ConcurrencySyncStateSchema = z.enum(SCORING_V2_CONCURRENCY_SYNC_STATES);

export interface ScoringV2ConcurrencyDTO {
  calibration: ScoringV2ConcurrencyLaneDTO;
  operation: ScoringV2ConcurrencyLaneDTO;
  /** Max static worker claim capacity (hard bound). */
  workerClaimHardMax: number;
  /** Evidence-based sync derivation from worker Redis observations. */
  syncState: ScoringV2ConcurrencySyncState;
  /**
   * Compatibility mirror — true only when `syncState === "SYNCHRONIZED"`.
   * Do not treat as authoritative; prefer `syncState`.
   */
  synchronized: boolean;
  settingsVersion: number;
  /** Distinct worker observation keys read from Redis (any freshness). */
  observedReplicaCount: number;
  oldestObservationAt: string | null;
  newestObservationAt: string | null;
}

export interface ScoringV2OverviewDTO {
  flags: ScoringV2FlagOverviewDTO;
  activeModel: ScoringV2ModelSummaryDTO | null;
  currentSeason: ScoringV2SeasonSummaryDTO | null;
  queueCounts: ScoringV2QueueCountsDTO[];
  recentEvidenceExport: ScoringV2EvidenceExportSummaryDTO | null;
  recentFrozenBundle: {
    exportId: string;
    contentHash: string;
    byteLength: number | null;
    frozenAt: string;
    cohortId: string;
    cohortRevision: number;
  } | null;
  cohortReadiness: {
    readyCohorts: number;
    draftCohorts: number;
    archivedCohorts: number;
  };
  concurrency: ScoringV2ConcurrencyDTO;
  blockers: ScoringV2IssueDTO[];
  warnings: ScoringV2IssueDTO[];
  applicationRevision: string | null;
  generatedAt: string;
}

export interface ScoringV2EvidenceExportProgressDTO {
  membersTotal: number;
  membersScanned: number;
  identitiesFound: number;
  identitiesMissing: number;
  bootstrapComplete: number;
  bootstrapIncomplete: number;
  manifestsPresent: number;
  fourDimensionComplete: number;
  compatibleSnapshots: number;
  incompatibleSnapshots: number;
}

export interface ScoringV2EvidenceExportDTO {
  id: string;
  cohortId: string;
  cohortName: string | null;
  cohortRevision: number;
  seasonId: string | null;
  scoreModelId: string | null;
  status: ScoringV2EvidenceExportStatus;
  progress: ScoringV2EvidenceExportProgressDTO;
  summary: Record<string, unknown>;
  issues: ScoringV2IssueDTO[];
  blockerCount: number;
  warningCount: number;
  archiveContentHash: string | null;
  archiveByteLength: number | null;
  summaryContentHash: string | null;
  preflightContentHash: string | null;
  markdownContentHash: string | null;
  frozenBundleContentHash: string | null;
  frozenBundleByteLength: number | null;
  frozenAt: string | null;
  freezeEligible: boolean;
  freezeBlockers: ScoringV2IssueDTO[];
  errorCode: string | null;
  errorMessage: string | null;
  requestedByUserId: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface ScoringV2EvidenceExportListDTO {
  items: ScoringV2EvidenceExportSummaryDTO[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ScoringV2HistoryItemDTO {
  kind: "evidence_export" | "frozen_bundle";
  id: string;
  exportId: string;
  cohortId: string;
  cohortName: string | null;
  cohortRevision: number;
  status: ScoringV2EvidenceExportStatus;
  initiatorUserId: string;
  createdAt: string;
  completedAt: string | null;
  rootHash: string | null;
  blockerCount: number;
  warningCount: number;
  downloadAvailable: boolean;
  linkedCalibrationRunId: string | null;
}

export interface ScoringV2HistoryListDTO {
  items: ScoringV2HistoryItemDTO[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ScoringV2FrozenBundleDTO {
  exportId: string;
  schemaVersion: string;
  rootHash: string;
  memberCount: number;
  excludedCount: number;
  byteLength: number;
  createdAt: string;
  deduplicated: boolean;
}
