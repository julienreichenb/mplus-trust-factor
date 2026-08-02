import { z } from "zod";
import type { IsoDateTime } from "./identity.js";

/** Max UTF-8 byte length for frozen CalibrationInputBundle JSONB (fail closed). */
export const CALIBRATION_INPUT_BUNDLE_MAX_BYTES = 4 * 1024 * 1024;

/** Digest algorithm version for Phase 1 deterministic digests (no weight recommendations). */
export const CALIBRATION_DIGEST_ALGORITHM_VERSION = "1.0.0" as const;

/** Calibration Input Bundle V2 schema version (root manifest + artifact refs). */
export const CALIBRATION_INPUT_BUNDLE_V2_SCHEMA_VERSION = "2.0.0" as const;

export const calibrationCohortStatusSchema = z.enum(["DRAFT", "READY", "ARCHIVED"]);
export type CalibrationCohortStatus = z.infer<typeof calibrationCohortStatusSchema>;

export const calibrationRunStatusSchema = z.enum([
  "QUEUED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
]);
export type CalibrationRunStatus = z.infer<typeof calibrationRunStatusSchema>;

export const calibrationRunModeSchema = z.enum([
  "PERSISTED_SNAPSHOT_ONLY",
  "DRAFT_MODEL_EVALUATE",
  "ACTIVE_VERSUS_DRAFT",
]);
export type CalibrationRunMode = z.infer<typeof calibrationRunModeSchema>;

export const calibrationExpectedLabelSchema = z.enum([
  "EXCELLENT",
  "GOOD",
  "AVERAGE",
  "WEAK",
  "OVERRATED",
]);
export type CalibrationExpectedLabel = z.infer<typeof calibrationExpectedLabelSchema>;

export const calibrationMemberSourceSchema = z.enum([
  "USER_SELECTED",
  "IMPORTED_STUDY",
  "STRATIFIED_AUTO",
]);
export type CalibrationMemberSource = z.infer<typeof calibrationMemberSourceSchema>;

export const calibrationEvidencePolicySchema = z.enum(["STRICT", "EXCLUDE_INVALID"]);
export type CalibrationEvidencePolicy = z.infer<typeof calibrationEvidencePolicySchema>;

export const calibrationPreflightSeveritySchema = z.enum(["BLOCKING", "WARNING", "INFO"]);
export type CalibrationPreflightSeverity = z.infer<typeof calibrationPreflightSeveritySchema>;

export const calibrationDigestAssessmentSchema = z.enum([
  "STRONG",
  "MODERATE",
  "WEAK",
  "INSUFFICIENT_EVIDENCE",
]);
export type CalibrationDigestAssessment = z.infer<typeof calibrationDigestAssessmentSchema>;

export const calibrationDigestConfidenceSchema = z.enum(["LOW", "MEDIUM", "HIGH"]);
export type CalibrationDigestConfidence = z.infer<typeof calibrationDigestConfidenceSchema>;

/** Map UI tier letters to expected labels (never from observed scores). */
export const CALIBRATION_TIER_TO_LABEL = {
  S: "EXCELLENT",
  A: "GOOD",
  B: "AVERAGE",
  C: "WEAK",
  D: "OVERRATED",
} as const satisfies Record<string, CalibrationExpectedLabel>;

export const CALIBRATION_LABEL_TO_QUALITATIVE = {
  EXCELLENT: "excellent",
  GOOD: "good",
  AVERAGE: "average",
  WEAK: "weak",
  OVERRATED: "overrated",
} as const;

export interface CalibrationCohortMemberDTO {
  id: string;
  cohortId: string;
  characterId: string | null;
  region: string;
  realmSlug: string;
  characterName: string;
  expectedLabel: CalibrationExpectedLabel;
  providedRole: "DPS" | "TANK" | "HEALER" | null;
  classSlug: string | null;
  specSlug: string | null;
  evidenceCutoffAt: IsoDateTime | null;
  rationale: string;
  source: CalibrationMemberSource;
  included: boolean;
  exclusionCode: string | null;
  exclusionDetail: string | null;
  preflightSnapshot: Record<string, unknown>;
  externalMemberKey: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface CalibrationCohortDTO {
  id: string;
  name: string;
  description: string;
  seasonId: string;
  status: CalibrationCohortStatus;
  revision: number;
  externalKey: string | null;
  createdByUserId: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  archivedAt: IsoDateTime | null;
  memberCount: number;
  includedMemberCount: number;
  members?: CalibrationCohortMemberDTO[];
}

export interface CalibrationPreflightIssueDTO {
  code: string;
  severity: CalibrationPreflightSeverity;
  memberId: string | null;
  message: string;
  nextActionHint: string | null;
}

export interface CalibrationPreflightMemberDTO {
  memberId: string;
  externalMemberKey: string | null;
  characterId: string | null;
  region: string;
  realmSlug: string;
  characterName: string;
  expectedLabel: CalibrationExpectedLabel;
  providedRole: "DPS" | "TANK" | "HEALER" | null;
  observedRole: "DPS" | "TANK" | "HEALER" | null;
  observedClassSlug: string | null;
  observedSpecSlug: string | null;
  bootstrapComplete: boolean;
  selectedSnapshotId: string | null;
  seasonCompatible: boolean;
  modelCompatible: boolean;
  replayable: boolean;
  missingEvidence: boolean;
  staleEvidence: boolean;
  included: boolean;
  exclusionCode: string | null;
  exclusionDetail: string | null;
  issues: CalibrationPreflightIssueDTO[];
}

export interface CalibrationPreflightResultDTO {
  cohortId: string;
  cohortRevision: number;
  seasonId: string;
  mode: CalibrationRunMode;
  activeModelId: string | null;
  evaluationModelId: string | null;
  generatedAt: IsoDateTime;
  blockingCount: number;
  warningCount: number;
  members: CalibrationPreflightMemberDTO[];
  issues: CalibrationPreflightIssueDTO[];
}

export interface CalibrationRunDTO {
  id: string;
  cohortId: string;
  cohortRevision: number;
  seasonId: string;
  mode: CalibrationRunMode;
  status: CalibrationRunStatus;
  activeModelId: string | null;
  evaluationModelId: string | null;
  evidencePolicy: string;
  inputBundleSchemaVersion: string;
  inputBundleContentHash: string;
  inputBundleByteLength: number;
  snapshotIds: string[];
  evidenceFingerprint: string | null;
  deterministicSeed: number;
  algorithmVersions: Record<string, unknown>;
  cancelRequestedAt: IsoDateTime | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdByUserId: string;
  createdAt: IsoDateTime;
  startedAt: IsoDateTime | null;
  completedAt: IsoDateTime | null;
  bullmqJobId: string | null;
  hasReport: boolean;
}

export interface CalibrationDigestFindingDTO {
  code: string;
  title: string;
  body: string;
  severity: CalibrationPreflightSeverity;
  metrics: Array<{ name: string; value: number | string | null }>;
  memberIds: string[];
  sliceKeys: string[];
}

export interface CalibrationDigestDTO {
  headline: string;
  overallAssessment: CalibrationDigestAssessment;
  strengths: CalibrationDigestFindingDTO[];
  issues: CalibrationDigestFindingDTO[];
  limitations: CalibrationDigestFindingDTO[];
  nextActions: CalibrationDigestFindingDTO[];
  confidence: CalibrationDigestConfidence;
  algorithmVersion: typeof CALIBRATION_DIGEST_ALGORITHM_VERSION;
}

export interface CalibrationReportDTO {
  id: string;
  runId: string;
  schemaVersion: string;
  digestAlgorithmVersion: string;
  recommendationAlgorithmVersion: string | null;
  summary: Record<string, unknown>;
  report: Record<string, unknown>;
  digest: CalibrationDigestDTO;
  limitations: unknown[];
  cohortSize: number;
  evaluatedCount: number;
  failedOrExcludedCount: number;
  spearman: number | null;
  pairwiseConcordance: number | null;
  meanScore: number | null;
  meanConfidence: number | null;
  outlierCount: number;
  contentHash: string;
  generatedAt: IsoDateTime;
  createdAt: IsoDateTime;
}

export const createCalibrationCohortBodySchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(4000).default(""),
  seasonId: z.string().uuid(),
  status: z.enum(["DRAFT", "READY"]).optional(),
  externalKey: z.string().min(1).max(200).nullable().optional(),
});

export type CreateCalibrationCohortBody = z.infer<typeof createCalibrationCohortBodySchema>;

export const patchCalibrationCohortBodySchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(4000).optional(),
    seasonId: z.string().uuid().optional(),
    status: z.enum(["DRAFT", "READY"]).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: "At least one field is required" });

export type PatchCalibrationCohortBody = z.infer<typeof patchCalibrationCohortBodySchema>;

export const createCalibrationMemberBodySchema = z.object({
  characterId: z.string().uuid().nullable().optional(),
  region: z.string().min(1).max(8),
  realmSlug: z.string().min(1).max(64),
  characterName: z.string().min(1).max(48),
  expectedLabel: calibrationExpectedLabelSchema,
  providedRole: z.enum(["DPS", "TANK", "HEALER"]).nullable().optional(),
  classSlug: z.string().min(1).max(64).nullable().optional(),
  specSlug: z.string().min(1).max(64).nullable().optional(),
  evidenceCutoffAt: z.string().datetime().nullable().optional(),
  rationale: z.string().min(1).max(4000),
  source: calibrationMemberSourceSchema.optional(),
  included: z.boolean().optional(),
  exclusionCode: z.string().min(1).max(128).nullable().optional(),
  exclusionDetail: z.string().max(4000).nullable().optional(),
  externalMemberKey: z.string().min(1).max(200).nullable().optional(),
});

export type CreateCalibrationMemberBody = z.infer<typeof createCalibrationMemberBodySchema>;

export const patchCalibrationMemberBodySchema = createCalibrationMemberBodySchema
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: "At least one field is required" });

export type PatchCalibrationMemberBody = z.infer<typeof patchCalibrationMemberBodySchema>;

/** Bounded bulk member upsert — per-row failures reported; no silent partial corruption. */
export const bulkCalibrationMembersBodySchema = z.object({
  members: z.array(createCalibrationMemberBodySchema).min(1).max(200),
  /** When true, replace all members for the cohort (editable cohorts only). */
  replaceAll: z.boolean().default(false),
});

export type BulkCalibrationMembersBody = z.infer<typeof bulkCalibrationMembersBodySchema>;

export const calibrationPreflightBodySchema = z.object({
  mode: calibrationRunModeSchema.default("PERSISTED_SNAPSHOT_ONLY"),
  activeModelId: z.string().uuid().nullable().optional(),
  evaluationModelId: z.string().uuid().nullable().optional(),
  seasonId: z.string().uuid().optional(),
});

export type CalibrationPreflightBody = z.infer<typeof calibrationPreflightBodySchema>;

export const createCalibrationRunBodySchema = z.object({
  mode: calibrationRunModeSchema.default("PERSISTED_SNAPSHOT_ONLY"),
  activeModelId: z.string().uuid().nullable().optional(),
  evaluationModelId: z.string().uuid().nullable().optional(),
  evidencePolicy: calibrationEvidencePolicySchema.default("STRICT"),
  deterministicSeed: z.number().int().nonnegative().default(0),
  /** Optional client-supplied expected cohort revision; rejects on mismatch. */
  expectedCohortRevision: z.number().int().positive().optional(),
});

export type CreateCalibrationRunBody = z.infer<typeof createCalibrationRunBodySchema>;

/** Create a new DRAFT ScoreModel from a source model (never mutates/activates the source). */
export const createCalibrationDraftModelBodySchema = z.object({
  sourceModelId: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(4000).optional(),
  /**
   * Optional full config for the new DRAFT. When omitted, the source config is cloned
   * verbatim. The source model is never updated.
   */
  config: z.record(z.string(), z.unknown()).optional(),
});

export type CreateCalibrationDraftModelBody = z.infer<typeof createCalibrationDraftModelBodySchema>;

/** BullMQ payload for dedicated `calibration-run` queue — not an IngestionJob. */
export const calibrationRunJobSchema = z.object({
  calibrationRunId: z.string().uuid(),
  requestedAt: z.string().datetime(),
  correlationId: z.string().min(1).max(128).nullable().optional(),
});

export type CalibrationRunJob = z.infer<typeof calibrationRunJobSchema>;
