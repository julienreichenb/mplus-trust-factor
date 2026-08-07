/**
 * Scoring Control Center contracts ÔÇö overview, evidence export, concurrency, history.
 * Admin-only. No secrets, provider tokens, or database URLs.
 */
import { z } from "zod";

export const REFRESH_WORKLOAD_CLASSES = ["CALIBRATION", "OPERATION"] as const;
export type RefreshWorkloadClass = (typeof REFRESH_WORKLOAD_CLASSES)[number];

export const refreshWorkloadClassSchema = z.enum(REFRESH_WORKLOAD_CLASSES);

export const SCORING_EVIDENCE_EXPORT_STATUSES = [
  "QUEUED",
  "RUNNING",
  "RETRYABLE",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;
export type ScoringEvidenceExportStatus = (typeof SCORING_EVIDENCE_EXPORT_STATUSES)[number];

export const ScoringEvidenceExportStatusSchema = z.enum(SCORING_EVIDENCE_EXPORT_STATUSES);

/** Typed runtime setting keys for refresh lane concurrency. */
export const RUNTIME_SETTING_KEYS = {
  concurrencyCalibration: "concurrency_calibration",
  concurrencyOperation: "concurrency_operation",
  /** Global concurrent WCL HTTP requests for Scoring acquisition. */
  wclGlobalHttpConcurrency: "wcl_global_http_concurrency",
  /** Max active run acquisitions per character. */
  wclPerCharacterRunConcurrency: "wcl_per_character_run_concurrency",
  /** Fraction of hourly WCL point budget to reserve (0.2 = 20%). */
  wclBudgetReserveRatio: "wcl_budget_reserve_ratio",
} as const;

export const CONCURRENCY_MIN = 1;
export const CONCURRENCY_MAX = 8;
export const DEFAULT_CONCURRENCY_CALIBRATION = 4;
export const DEFAULT_CONCURRENCY_OPERATION = 2;
export const DEFAULT_WCL_GLOBAL_HTTP_CONCURRENCY = 3;
export const DEFAULT_WCL_PER_CHARACTER_RUN_CONCURRENCY = 2;
export const DEFAULT_WCL_BUDGET_RESERVE_RATIO = 0.2;

export const concurrencyValueSchema = z
  .number()
  .int()
  .min(CONCURRENCY_MIN)
  .max(CONCURRENCY_MAX);

export const EVIDENCE_JOIN_PREFLIGHT_SCHEMA_VERSION = "scoring-evidence-join-preflight-v1" as const;

export const ScoringModeLabelSchema = z.enum(["Disabled", "Shadow", "Candidate", "Active"]);
export type ScoringModeLabel = z.infer<typeof ScoringModeLabelSchema>;

export const ScoringIssueSeveritySchema = z.enum(["blocker", "warning", "info"]);
export type ScoringIssueSeverity = z.infer<typeof ScoringIssueSeveritySchema>;

export const ScoringIssueSchema = z.object({
  code: z.string().min(1).max(128),
  severity: ScoringIssueSeveritySchema,
  message: z.string().min(1).max(512),
  memberId: z.string().max(128).nullable().optional(),
});
export type ScoringIssueDTO = z.infer<typeof ScoringIssueSchema>;

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
  /** Optimistic concurrency ÔÇö must match current settings version. */
  expectedVersion: z.number().int().positive(),
});
export type UpdateConcurrencyBody = z.infer<typeof updateConcurrencyBodySchema>;

export const freezeEvidenceBundleBodySchema = z.object({
  /** Explicit confirmation required. */
  confirm: z.literal(true),
  /** Optional DRAFT/evaluation model ÔÇö frozen only when explicitly selected. */
  evaluationModelId: z.string().uuid().optional().nullable(),
});
export type FreezeEvidenceBundleBody = z.infer<typeof freezeEvidenceBundleBodySchema>;

export const ScoringEvidenceExportJobSchema = z.object({
  exportId: z.string().uuid(),
  requestedAt: z.string().datetime(),
  correlationId: z.string().min(1).max(128).nullable().optional(),
});
export type ScoringEvidenceExportJob = z.infer<typeof ScoringEvidenceExportJobSchema>;

export const ScoringShadowCanaryJobSchema = z.object({
  canaryId: z.string().uuid(),
  region: z.enum(["EU", "US", "KR", "TW"]),
  realmSlug: z.string().min(1).max(64),
  characterName: z.string().min(1).max(48),
  requestedAt: z.string().datetime(),
  correlationId: z.string().min(1).max(128).nullable().optional(),
  forceRefresh: z.boolean().default(false),
});
export type ScoringShadowCanaryJob = z.infer<typeof ScoringShadowCanaryJobSchema>;

export interface ScoringFlagOverviewDTO {
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
  modeLabel: ScoringModeLabel;
  incompatibleReasons: string[];
}

export interface ScoringModelSummaryDTO {
  id: string;
  key: string;
  version: number;
  name: string;
  status: string;
}

export interface ScoringSeasonSummaryDTO {
  id: string;
  slug: string;
  name: string;
  isCurrent: boolean;
  blizzardSeasonId: number | null;
}

export interface ScoringQueueCountsDTO {
  workloadClass: RefreshWorkloadClass | "CALIBRATION_RUN" | "EVIDENCE_EXPORT" | "OTHER";
  queued: number;
  active: number;
}

export interface ScoringEvidenceExportSummaryDTO {
  id: string;
  cohortId: string;
  cohortName: string | null;
  cohortRevision: number;
  seasonId: string | null;
  status: ScoringEvidenceExportStatus;
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

export interface ScoringConcurrencyLaneDTO {
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
export const SCORING_CONCURRENCY_SYNC_STATES = [
  "SYNCHRONIZED",
  "PARTIALLY_OBSERVED",
  "STALE",
  "UNSYNCHRONIZED",
  "UNKNOWN",
] as const;
export type ScoringConcurrencySyncState = (typeof SCORING_CONCURRENCY_SYNC_STATES)[number];
export const ScoringConcurrencySyncStateSchema = z.enum(SCORING_CONCURRENCY_SYNC_STATES);

export interface ScoringConcurrencyDTO {
  calibration: ScoringConcurrencyLaneDTO;
  operation: ScoringConcurrencyLaneDTO;
  /** Max static worker claim capacity (hard bound). */
  workerClaimHardMax: number;
  /** Evidence-based sync derivation from worker Redis observations. */
  syncState: ScoringConcurrencySyncState;
  /**
   * Compatibility mirror ÔÇö true only when `syncState === "SYNCHRONIZED"`.
   * Do not treat as authoritative; prefer `syncState`.
   */
  synchronized: boolean;
  settingsVersion: number;
  /** Distinct worker observation keys read from Redis (any freshness). */
  observedReplicaCount: number;
  oldestObservationAt: string | null;
  newestObservationAt: string | null;
}

/**
 * Control-center overview DTO ÔÇö OpenAPI `overviewSchema` must mirror these exact keys
 * with `additionalProperties: false`.
 */
export interface ScoringOverviewDTO {
  flags: ScoringFlagOverviewDTO;
  activeModel: ScoringModelSummaryDTO | null;
  currentSeason: ScoringSeasonSummaryDTO | null;
  queueCounts: ScoringQueueCountsDTO[];
  recentEvidenceExport: ScoringEvidenceExportSummaryDTO | null;
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
  concurrency: ScoringConcurrencyDTO;
  blockers: ScoringIssueDTO[];
  warnings: ScoringIssueDTO[];
  applicationRevision: string | null;
  generatedAt: string;
}

/**
 * Evidence-export progress counters ÔÇö closed set of known fields.
 * OpenAPI (`evidenceExportProgressSchema`) must list these with `additionalProperties: false`.
 */
export interface ScoringEvidenceExportProgressDTO {
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

export interface ScoringEvidenceExportDTO {
  id: string;
  cohortId: string;
  cohortName: string | null;
  cohortRevision: number;
  seasonId: string | null;
  scoreModelId: string | null;
  status: ScoringEvidenceExportStatus;
  progress: ScoringEvidenceExportProgressDTO;
  /** Extensible bag ÔÇö OpenAPI may keep `additionalProperties: true` only on this nested object. */
  summary: Record<string, unknown>;
  issues: ScoringIssueDTO[];
  blockerCount: number;
  warningCount: number;
  archiveContentHash: string | null;
  archiveByteLength: number | null;
  summaryContentHash: string | null;
  preflightContentHash: string | null;
  markdownContentHash: string | null;
  /** Logical bundle root hash (bundleHash). */
  frozenBundleContentHash: string | null;
  /** CAS digest of persisted JSON bytes (`sha256:<64hex>`). */
  frozenBundleByteDigest: string | null;
  frozenBundleByteLength: number | null;
  frozenAt: string | null;
  freezeEligible: boolean;
  freezeBlockers: ScoringIssueDTO[];
  errorCode: string | null;
  errorMessage: string | null;
  requestedByUserId: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface ScoringEvidenceExportListDTO {
  items: ScoringEvidenceExportSummaryDTO[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ScoringHistoryItemDTO {
  kind: "evidence_export" | "frozen_bundle";
  id: string;
  exportId: string;
  cohortId: string;
  cohortName: string | null;
  cohortRevision: number;
  status: ScoringEvidenceExportStatus;
  initiatorUserId: string;
  createdAt: string;
  completedAt: string | null;
  rootHash: string | null;
  blockerCount: number;
  warningCount: number;
  downloadAvailable: boolean;
  linkedCalibrationRunId: string | null;
}

export interface ScoringHistoryListDTO {
  items: ScoringHistoryItemDTO[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ScoringFrozenBundleDTO {
  exportId: string;
  schemaVersion: string;
  /** Logical bundle root hash (bundleHash / frozenBundleContentHash). */
  rootHash: string;
  frozenBundleContentHash: string;
  /** CAS digest of persisted JSON bytes (`sha256:<64hex>`). */
  frozenBundleByteDigest: string;
  memberCount: number;
  excludedCount: number;
  byteLength: number;
  createdAt: string;
  deduplicated: boolean;
}
