/**
 * OpenAPI / Fastify schemas for Scoring V2 Control Center endpoints.
 * Keep aligned with @mplus/contracts scoring-v2-control-center DTOs.
 * Never expose secrets or connection strings.
 */
import { errorResponseSchema } from "./schemas.js";

const authErrorResponses = {
  401: errorResponseSchema,
  403: errorResponseSchema,
} as const;

const conflictErrorResponses = {
  409: errorResponseSchema,
  ...authErrorResponses,
} as const;

export const scoringV2IssueSchema = {
  type: "object",
  properties: {
    code: { type: "string" },
    severity: { type: "string", enum: ["blocker", "warning", "info"] },
    message: { type: "string" },
    memberId: { type: ["string", "null"] },
  },
  required: ["code", "severity", "message"],
  additionalProperties: true,
} as const;

export const workloadClassSchema = {
  type: "string",
  enum: ["CALIBRATION", "OPERATION"],
} as const;

export const concurrencyLaneSchema = {
  type: "object",
  properties: {
    workloadClass: workloadClassSchema,
    configured: { type: "integer", minimum: 1, maximum: 8 },
    effective: { type: "integer", minimum: 1, maximum: 8 },
    active: { type: "integer", minimum: 0 },
    queued: { type: "integer", minimum: 0 },
    version: { type: "integer" },
    updatedAt: { type: "string" },
    updatedByUserId: { type: ["string", "null"] },
  },
  required: ["workloadClass", "configured", "effective", "active", "queued"],
  additionalProperties: true,
} as const;

export const concurrencyDtoSchema = {
  type: "object",
  properties: {
    calibration: concurrencyLaneSchema,
    operation: concurrencyLaneSchema,
    workerClaimHardMax: { type: "integer" },
    syncState: {
      type: "string",
      enum: ["SYNCHRONIZED", "PARTIALLY_OBSERVED", "STALE", "UNSYNCHRONIZED", "UNKNOWN"],
    },
    synchronized: { type: "boolean" },
    settingsVersion: { type: "integer" },
    observedReplicaCount: { type: "integer", minimum: 0 },
    oldestObservationAt: { type: ["string", "null"] },
    newestObservationAt: { type: ["string", "null"] },
  },
  required: [
    "calibration",
    "operation",
    "workerClaimHardMax",
    "syncState",
    "synchronized",
    "settingsVersion",
    "observedReplicaCount",
    "oldestObservationAt",
    "newestObservationAt",
  ],
  additionalProperties: true,
} as const;

export const updateConcurrencyBodyOpenApiSchema = {
  type: "object",
  properties: {
    concurrencyCalibration: { type: "integer", minimum: 1, maximum: 8 },
    concurrencyOperation: { type: "integer", minimum: 1, maximum: 8 },
    expectedVersion: { type: "integer", minimum: 1 },
  },
  required: ["expectedVersion"],
  additionalProperties: false,
} as const;

export const paginationQuerySchema = {
  type: "object",
  properties: {
    page: { type: "integer", minimum: 1, default: 1 },
    pageSize: { type: "integer", minimum: 1, maximum: 50, default: 20 },
  },
  additionalProperties: false,
} as const;

export const createEvidenceExportBodyOpenApiSchema = {
  type: "object",
  properties: {
    cohortId: { type: "string", format: "uuid" },
    cohortRevision: { type: "integer", minimum: 1 },
    seasonId: { type: "string", format: "uuid" },
  },
  required: ["cohortId"],
  additionalProperties: false,
} as const;

export const freezeEvidenceBundleBodyOpenApiSchema = {
  type: "object",
  properties: {
    confirm: { type: "boolean", enum: [true] },
    evaluationModelId: { type: ["string", "null"], format: "uuid" },
  },
  required: ["confirm"],
  additionalProperties: false,
} as const;

export const evidenceExportDtoSchema = {
  type: "object",
  properties: {
    id: { type: "string", format: "uuid" },
    cohortId: { type: "string", format: "uuid" },
    cohortName: { type: ["string", "null"] },
    cohortRevision: { type: "integer" },
    seasonId: { type: ["string", "null"] },
    scoreModelId: { type: ["string", "null"] },
    status: {
      type: "string",
      enum: ["QUEUED", "RUNNING", "RETRYABLE", "COMPLETED", "FAILED", "CANCELLED"],
    },
    progress: { type: "object", additionalProperties: true },
    summary: { type: "object", additionalProperties: true },
    issues: { type: "array", items: scoringV2IssueSchema },
    blockerCount: { type: "integer" },
    warningCount: { type: "integer" },
    archiveContentHash: { type: ["string", "null"] },
    archiveByteLength: { type: ["integer", "null"] },
    summaryContentHash: { type: ["string", "null"] },
    preflightContentHash: { type: ["string", "null"] },
    markdownContentHash: { type: ["string", "null"] },
    frozenBundleContentHash: { type: ["string", "null"] },
    frozenBundleByteLength: { type: ["integer", "null"] },
    frozenAt: { type: ["string", "null"] },
    freezeEligible: { type: "boolean" },
    freezeBlockers: { type: "array", items: scoringV2IssueSchema },
    errorCode: { type: ["string", "null"] },
    errorMessage: { type: ["string", "null"] },
    requestedByUserId: { type: "string" },
    createdAt: { type: "string" },
    startedAt: { type: ["string", "null"] },
    completedAt: { type: ["string", "null"] },
  },
  required: ["id", "cohortId", "status", "freezeEligible", "freezeBlockers"],
  additionalProperties: true,
} as const;

export const frozenBundleDtoSchema = {
  type: "object",
  properties: {
    exportId: { type: "string", format: "uuid" },
    schemaVersion: { type: "string" },
    rootHash: { type: "string" },
    memberCount: { type: "integer" },
    excludedCount: { type: "integer" },
    byteLength: { type: "integer" },
    createdAt: { type: "string" },
    deduplicated: { type: "boolean" },
  },
  required: ["exportId", "schemaVersion", "rootHash", "memberCount", "excludedCount", "byteLength"],
  additionalProperties: true,
} as const;

export const overviewSchema = {
  type: "object",
  additionalProperties: true,
  properties: {
    flags: { type: "object", additionalProperties: true },
    concurrency: concurrencyDtoSchema,
    blockers: { type: "array", items: scoringV2IssueSchema },
    warnings: { type: "array", items: scoringV2IssueSchema },
    generatedAt: { type: "string" },
  },
} as const;

export const listExportsSchema = {
  type: "object",
  properties: {
    items: { type: "array", items: { type: "object", additionalProperties: true } },
    total: { type: "integer" },
    page: { type: "integer", minimum: 1 },
    pageSize: { type: "integer", minimum: 1, maximum: 50 },
  },
  required: ["items", "total", "page", "pageSize"],
  additionalProperties: true,
} as const;

export const historyListSchema = listExportsSchema;

export const freezeBundleResponseSchema = {
  type: "object",
  properties: {
    export: evidenceExportDtoSchema,
    bundle: frozenBundleDtoSchema,
  },
  required: ["export", "bundle"],
  additionalProperties: true,
} as const;

/** Binary ZIP archive — documented as application/zip octet stream. */
export const zipDownloadResponseSchema = {
  type: "string",
  format: "binary",
  description: "ZIP archive of evidence-join artifacts (application/zip)",
} as const;

export const scoringV2ControlCenterTags = ["admin-scoring-v2"] as const;

export { authErrorResponses, conflictErrorResponses, errorResponseSchema };
