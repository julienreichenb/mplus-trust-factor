/**
 * OpenAPI / Fastify schemas for Scoring V2 Control Center endpoints.
 * Keep aligned with @mplus/contracts scoring-v2-control-center DTOs.
 * Never expose secrets or connection strings.
 *
 * Response objects use `additionalProperties: false` unless a nested bag is
 * intentionally extensible (`summary: Record<string, unknown>`).
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
  additionalProperties: false,
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
    updatedAt: { type: ["string", "null"] },
    updatedByUserId: { type: ["string", "null"] },
  },
  required: ["workloadClass", "configured", "effective", "active", "queued"],
  additionalProperties: false,
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
  additionalProperties: false,
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

/** Aligns with ScoringV2EvidenceExportProgressDTO — known fields only. */
export const evidenceExportProgressSchema = {
  type: "object",
  properties: {
    membersTotal: { type: "integer" },
    membersScanned: { type: "integer" },
    identitiesFound: { type: "integer" },
    identitiesMissing: { type: "integer" },
    bootstrapComplete: { type: "integer" },
    bootstrapIncomplete: { type: "integer" },
    manifestsPresent: { type: "integer" },
    fourDimensionComplete: { type: "integer" },
    compatibleSnapshots: { type: "integer" },
    incompatibleSnapshots: { type: "integer" },
  },
  required: [
    "membersTotal",
    "membersScanned",
    "identitiesFound",
    "identitiesMissing",
    "bootstrapComplete",
    "bootstrapIncomplete",
    "manifestsPresent",
    "fourDimensionComplete",
    "compatibleSnapshots",
    "incompatibleSnapshots",
  ],
  additionalProperties: false,
} as const;

/**
 * Aligns with ScoringV2EvidenceExportDTO.
 * `summary` stays extensible (`Record<string, unknown>` in contracts).
 */
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
    progress: evidenceExportProgressSchema,
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
    frozenBundleByteDigest: { type: ["string", "null"] },
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
  additionalProperties: false,
} as const;

/** Aligns with ScoringV2EvidenceExportSummaryDTO (list/overview recent export). */
export const evidenceExportSummaryDtoSchema = {
  type: "object",
  properties: {
    id: { type: "string", format: "uuid" },
    cohortId: { type: "string", format: "uuid" },
    cohortName: { type: ["string", "null"] },
    cohortRevision: { type: "integer" },
    seasonId: { type: ["string", "null"] },
    status: {
      type: "string",
      enum: ["QUEUED", "RUNNING", "RETRYABLE", "COMPLETED", "FAILED", "CANCELLED"],
    },
    blockerCount: { type: "integer" },
    warningCount: { type: "integer" },
    archiveContentHash: { type: ["string", "null"] },
    frozenBundleContentHash: { type: ["string", "null"] },
    frozenAt: { type: ["string", "null"] },
    requestedByUserId: { type: "string" },
    createdAt: { type: "string" },
    startedAt: { type: ["string", "null"] },
    completedAt: { type: ["string", "null"] },
  },
  required: ["id", "cohortId", "status", "cohortRevision", "blockerCount", "warningCount"],
  additionalProperties: false,
} as const;

export const frozenBundleDtoSchema = {
  type: "object",
  properties: {
    exportId: { type: "string", format: "uuid" },
    schemaVersion: { type: "string" },
    rootHash: { type: "string" },
    frozenBundleContentHash: { type: "string" },
    frozenBundleByteDigest: { type: "string" },
    memberCount: { type: "integer" },
    excludedCount: { type: "integer" },
    byteLength: { type: "integer" },
    createdAt: { type: "string" },
    deduplicated: { type: "boolean" },
  },
  required: [
    "exportId",
    "schemaVersion",
    "rootHash",
    "frozenBundleContentHash",
    "frozenBundleByteDigest",
    "memberCount",
    "excludedCount",
    "byteLength",
  ],
  additionalProperties: false,
} as const;

/** Aligns with ScoringV2FlagOverviewDTO. */
export const scoringV2FlagOverviewSchema = {
  type: "object",
  properties: {
    masterEnabled: { type: "boolean" },
    selectionEnabled: { type: "boolean" },
    evidenceFetchEnabled: { type: "boolean" },
    dimensionsEnabled: { type: "boolean" },
    publicationEnabled: { type: "boolean" },
    calibrationV2Enabled: { type: "boolean" },
    adminCalibrationEnabled: { type: "boolean" },
    performanceEnabled: { type: "boolean" },
    survivalEnabled: { type: "boolean" },
    utilityEnabled: { type: "boolean" },
    experienceEnabled: { type: "boolean" },
    relativeDamageMode: { type: "string", enum: ["off", "shadow", "active"] },
    utilityOpportunityMode: { type: "string", enum: ["off", "shadow", "active"] },
    referenceComparisonMode: { type: "string", enum: ["off", "collect", "shadow", "active"] },
    modeLabel: { type: "string", enum: ["Disabled", "Shadow", "Candidate", "Active"] },
    incompatibleReasons: { type: "array", items: { type: "string" } },
  },
  required: [
    "masterEnabled",
    "selectionEnabled",
    "evidenceFetchEnabled",
    "dimensionsEnabled",
    "publicationEnabled",
    "calibrationV2Enabled",
    "adminCalibrationEnabled",
    "performanceEnabled",
    "survivalEnabled",
    "utilityEnabled",
    "experienceEnabled",
    "relativeDamageMode",
    "utilityOpportunityMode",
    "referenceComparisonMode",
    "modeLabel",
    "incompatibleReasons",
  ],
  additionalProperties: false,
} as const;

export const scoringV2ModelSummarySchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    key: { type: "string" },
    version: { type: "integer" },
    name: { type: "string" },
    status: { type: "string" },
  },
  required: ["id", "key", "version", "name", "status"],
  additionalProperties: false,
} as const;

export const scoringV2SeasonSummarySchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    slug: { type: "string" },
    name: { type: "string" },
    isCurrent: { type: "boolean" },
    blizzardSeasonId: { type: ["integer", "null"] },
  },
  required: ["id", "slug", "name", "isCurrent", "blizzardSeasonId"],
  additionalProperties: false,
} as const;

export const scoringV2QueueCountsSchema = {
  type: "object",
  properties: {
    workloadClass: {
      type: "string",
      enum: ["CALIBRATION", "OPERATION", "CALIBRATION_RUN", "EVIDENCE_EXPORT", "OTHER"],
    },
    queued: { type: "integer" },
    active: { type: "integer" },
  },
  required: ["workloadClass", "queued", "active"],
  additionalProperties: false,
} as const;

export const recentFrozenBundleOverviewSchema = {
  type: "object",
  properties: {
    exportId: { type: "string" },
    contentHash: { type: "string" },
    byteLength: { type: ["integer", "null"] },
    frozenAt: { type: "string" },
    cohortId: { type: "string" },
    cohortRevision: { type: "integer" },
  },
  required: ["exportId", "contentHash", "byteLength", "frozenAt", "cohortId", "cohortRevision"],
  additionalProperties: false,
} as const;

export const cohortReadinessSchema = {
  type: "object",
  properties: {
    readyCohorts: { type: "integer" },
    draftCohorts: { type: "integer" },
    archivedCohorts: { type: "integer" },
  },
  required: ["readyCohorts", "draftCohorts", "archivedCohorts"],
  additionalProperties: false,
} as const;

/** Aligns with ScoringV2OverviewDTO exact properties. */
export const overviewSchema = {
  type: "object",
  properties: {
    flags: scoringV2FlagOverviewSchema,
    activeModel: { anyOf: [scoringV2ModelSummarySchema, { type: "null" }] },
    currentSeason: { anyOf: [scoringV2SeasonSummarySchema, { type: "null" }] },
    queueCounts: { type: "array", items: scoringV2QueueCountsSchema },
    recentEvidenceExport: { anyOf: [evidenceExportSummaryDtoSchema, { type: "null" }] },
    recentFrozenBundle: { anyOf: [recentFrozenBundleOverviewSchema, { type: "null" }] },
    cohortReadiness: cohortReadinessSchema,
    concurrency: concurrencyDtoSchema,
    blockers: { type: "array", items: scoringV2IssueSchema },
    warnings: { type: "array", items: scoringV2IssueSchema },
    applicationRevision: { type: ["string", "null"] },
    generatedAt: { type: "string" },
  },
  required: [
    "flags",
    "activeModel",
    "currentSeason",
    "queueCounts",
    "recentEvidenceExport",
    "recentFrozenBundle",
    "cohortReadiness",
    "concurrency",
    "blockers",
    "warnings",
    "applicationRevision",
    "generatedAt",
  ],
  additionalProperties: false,
} as const;

/**
 * List response — items use the full evidence export DTO schema (OpenAPI surface).
 * Runtime list projection may omit optional detail fields.
 */
export const listExportsSchema = {
  type: "object",
  properties: {
    items: { type: "array", items: evidenceExportSummaryDtoSchema },
    total: { type: "integer" },
    page: { type: "integer", minimum: 1 },
    pageSize: { type: "integer", minimum: 1, maximum: 50 },
  },
  required: ["items", "total", "page", "pageSize"],
  additionalProperties: false,
} as const;

/** Aligns with ScoringV2HistoryItemDTO. */
export const historyItemDtoSchema = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["evidence_export", "frozen_bundle"] },
    id: { type: "string" },
    exportId: { type: "string" },
    cohortId: { type: "string" },
    cohortName: { type: ["string", "null"] },
    cohortRevision: { type: "integer" },
    status: {
      type: "string",
      enum: ["QUEUED", "RUNNING", "RETRYABLE", "COMPLETED", "FAILED", "CANCELLED"],
    },
    initiatorUserId: { type: "string" },
    createdAt: { type: "string" },
    completedAt: { type: ["string", "null"] },
    rootHash: { type: ["string", "null"] },
    blockerCount: { type: "integer" },
    warningCount: { type: "integer" },
    downloadAvailable: { type: "boolean" },
    linkedCalibrationRunId: { type: ["string", "null"] },
  },
  required: [
    "kind",
    "id",
    "exportId",
    "cohortId",
    "cohortRevision",
    "status",
    "initiatorUserId",
    "createdAt",
    "downloadAvailable",
  ],
  additionalProperties: false,
} as const;

/** Aligns with ScoringV2HistoryListDTO. */
export const historyListSchema = {
  type: "object",
  properties: {
    items: { type: "array", items: historyItemDtoSchema },
    total: { type: "integer" },
    page: { type: "integer", minimum: 1 },
    pageSize: { type: "integer", minimum: 1, maximum: 50 },
  },
  required: ["items", "total", "page", "pageSize"],
  additionalProperties: false,
} as const;

export const freezeBundleResponseSchema = {
  type: "object",
  properties: {
    export: evidenceExportDtoSchema,
    bundle: frozenBundleDtoSchema,
  },
  required: ["export", "bundle"],
  additionalProperties: false,
} as const;

/** Binary ZIP archive — documented as application/zip octet stream. */
export const zipDownloadResponseSchema = {
  type: "string",
  format: "binary",
  description: "ZIP archive of evidence-join artifacts (application/zip)",
} as const;

export const scoringV2ControlCenterTags = ["admin-scoring-v2"] as const;

export { authErrorResponses, conflictErrorResponses, errorResponseSchema };
