/**
 * Scoring V2 evidence persistence + feature-lineage audit DTOs.
 * Provider-free, bounded — never embeds raw WCL event arrays or secrets.
 */

import { z } from "zod";
import { evidenceDatasetKindSchema, evidenceSlotStateSchema } from "./evidence-v2.js";

export const EVIDENCE_AUDIT_V2_SCHEMA_VERSION = "2.0.0" as const;
export const FEATURE_REGISTRY_V2_VERSION = "feature-registry-v2.0.0" as const;

export const featureScoringRoleSchema = z.enum([
  "SCORE",
  "CONFIDENCE",
  "AVAILABILITY",
  "EXPLAINABILITY_ONLY",
]);
export type FeatureScoringRole = z.infer<typeof featureScoringRoleSchema>;

export const slotAuditStateSchema = z.enum([
  "COMPLETE",
  "PARTIAL",
  "UNAVAILABLE",
  "BROKEN",
]);
export type SlotAuditState = z.infer<typeof slotAuditStateSchema>;

export const datasetPersistenceStateSchema = z.enum([
  "PRESENT",
  "ZERO_EVENT",
  "MISSING",
  "FAILED",
  "UNAVAILABLE",
  "BROKEN",
]);
export type DatasetPersistenceState = z.infer<typeof datasetPersistenceStateSchema>;

export const factSourceOutcomeSchema = z.enum([
  "WRITTEN",
  "UNAVAILABLE",
  "FAILED",
  "NOT_ENABLED",
]);
export type FactSourceOutcome = z.infer<typeof factSourceOutcomeSchema>;

/** Bounded RawArtifact / page lineage reference — never embeds raw bytes. */
export const evidenceAuditArtifactRefSchema = z.object({
  artifactId: z.string().min(1),
  provider: z.string().nullable(),
  artifactClass: z.string().nullable(),
  contentHash: z.string().nullable(),
  byteLength: z.number().int().nonnegative().nullable(),
});
export type EvidenceAuditArtifactRef = z.infer<typeof evidenceAuditArtifactRefSchema>;

export const frozenIdentityCompletenessSchema = z.enum([
  "COMPLETE",
  "INCOMPLETE",
  "NOT_APPLICABLE",
]);
export type FrozenIdentityCompleteness = z.infer<typeof frozenIdentityCompletenessSchema>;

export const duplicateIdentityStatusSchema = z.enum([
  "UNIQUE",
  "DUPLICATE",
  "NOT_APPLICABLE",
]);
export type DuplicateIdentityStatus = z.infer<typeof duplicateIdentityStatusSchema>;

export const featureUsageEntrySchema = z.object({
  featurePath: z.string().min(1),
  selectedSlotCountContaining: z.number().int().nonnegative(),
  validValueCount: z.number().int().nonnegative(),
  missingCount: z.number().int().nonnegative(),
  zeroCount: z.number().int().nonnegative().nullable(),
  scoringRole: featureScoringRoleSchema,
  consumed: z.boolean(),
  outputComponentOrConfidenceField: z.string().nullable(),
  exclusionReason: z.string().nullable(),
});
export type FeatureUsageEntry = z.infer<typeof featureUsageEntrySchema>;

export const evidenceAuditDatasetPageSchema = z.object({
  pageIndex: z.number().int().nonnegative(),
  artifactId: z.string().nullable(),
  contentHash: z.string().nullable(),
  eventCount: z.number().int().nonnegative(),
  scopeFingerprint: z.string().nullable(),
});
export type EvidenceAuditDatasetPage = z.infer<typeof evidenceAuditDatasetPageSchema>;

export const evidenceAuditDatasetEntrySchema = z.object({
  datasetKind: evidenceDatasetKindSchema,
  required: z.boolean(),
  consumers: z.array(z.enum(["PERFORMANCE", "SURVIVAL", "UTILITY"])),
  rowPresent: z.boolean(),
  compatibilityKey: z.string().nullable(),
  manifestSlotId: z.string().nullable(),
  artifactId: z.string().nullable(),
  payloadFingerprint: z.string().nullable(),
  eventCount: z.number().int().nonnegative().nullable(),
  pageCount: z.number().int().nonnegative().nullable(),
  truncated: z.boolean().nullable(),
  pages: z.array(evidenceAuditDatasetPageSchema),
  schemaVersion: z.string().nullable(),
  providerContractVersion: z.string().nullable(),
  persistenceState: datasetPersistenceStateSchema,
  integrityErrors: z.array(z.string()),
});
export type EvidenceAuditDatasetEntry = z.infer<typeof evidenceAuditDatasetEntrySchema>;

export const evidenceAuditMasterDataSchema = z.object({
  present: z.boolean(),
  reportCode: z.string().nullable(),
  fightId: z.number().int().nullable(),
  reportRevision: z.number().int().nullable(),
  masterDataArtifactId: z.string().nullable(),
  digestId: z.string().nullable(),
  contentFingerprint: z.string().nullable(),
  persistenceState: datasetPersistenceStateSchema,
  integrityErrors: z.array(z.string()),
});
export type EvidenceAuditMasterData = z.infer<typeof evidenceAuditMasterDataSchema>;

export const evidenceAuditRankingParseSchema = z.object({
  present: z.boolean(),
  /** Logical acquisition outcome for the selected slot (cache hits still record an outcome). */
  logicalOutcome: factSourceOutcomeSchema,
  semantic: z.string().nullable(),
  factSetId: z.string().nullable(),
  inputFingerprint: z.string().nullable(),
  reason: z.string().nullable(),
  category: z.string().nullable(),
  unavailableProvenance: z.array(z.string()),
  limitations: z.array(z.string()),
  persistenceState: datasetPersistenceStateSchema,
  /** True when EvidenceDataset descriptor exists (pages are not produced for RANKING_PARSE). */
  descriptorPresent: z.boolean(),
  integrityErrors: z.array(z.string()),
});
export type EvidenceAuditRankingParse = z.infer<typeof evidenceAuditRankingParseSchema>;

export const evidenceAuditFactSetEntrySchema = z.object({
  extractorFamily: z.enum(["PERFORMANCE", "SURVIVAL", "UTILITY"]),
  runFactSetPresent: z.boolean(),
  extractorVersion: z.string().nullable(),
  schemaVersion: z.string().nullable(),
  inputFingerprint: z.string().nullable(),
  /** Identity parsed from the fact document (not copied from the slot row). */
  reportCode: z.string().nullable(),
  fightId: z.number().int().nullable(),
  reportRevision: z.number().int().nullable(),
  /** Database slot relation identity (may differ from fact document). */
  relationReportCode: z.string().nullable(),
  relationFightId: z.number().int().nullable(),
  relationReportRevision: z.number().int().nullable(),
  manifestSlotId: z.string().nullable(),
  artifactReferences: z.array(evidenceAuditArtifactRefSchema),
  coverage: z.record(z.string(), z.unknown()).nullable(),
  limitations: z.array(z.string()),
  parserValidation: z.enum(["VALID", "INVALID", "SKIPPED", "UNAVAILABLE"]),
  sourceOutcome: factSourceOutcomeSchema,
  boundedFactsSummary: z.record(z.string(), z.unknown()).nullable(),
  hashMatchAgainstManifest: z.boolean().nullable(),
  identityMatchAgainstManifest: z.boolean().nullable(),
});
export type EvidenceAuditFactSetEntry = z.infer<typeof evidenceAuditFactSetEntrySchema>;

export const evidenceAuditSlotSchema = z.object({
  dungeonSlug: z.string().min(1),
  slotIndex: z.union([z.literal(0), z.literal(1)]),
  slotId: z.string().nullable(),
  manifestSlotRowId: z.string().nullable(),
  slotState: evidenceSlotStateSchema.nullable(),
  reportCode: z.string().nullable(),
  fightId: z.number().int().nullable(),
  reportRevision: z.number().int().nullable(),
  keyLevel: z.number().int().nullable(),
  selectionReason: z.string().nullable(),
  selectedRank: z.number().int().nullable(),
  fallbackReason: z.string().nullable(),
  frozenIdentityCompleteness: frozenIdentityCompletenessSchema,
  duplicateIdentityStatus: duplicateIdentityStatusSchema,
  manifestFactSetHash: z.string().nullable(),
  computedFactSetBindingHash: z.string().nullable(),
  slotAuditState: slotAuditStateSchema,
  eventDatasets: z.array(evidenceAuditDatasetEntrySchema),
  masterData: evidenceAuditMasterDataSchema.nullable(),
  rankingParse: evidenceAuditRankingParseSchema.nullable(),
  factSets: z.array(evidenceAuditFactSetEntrySchema),
  integrityErrors: z.array(z.string()),
});
export type EvidenceAuditSlot = z.infer<typeof evidenceAuditSlotSchema>;

export const evidenceAuditFeatureRegistryEntrySchema = z.object({
  featurePath: z.string().min(1),
  dimension: z.enum(["PERFORMANCE", "SURVIVAL", "UTILITY"]),
  sourceDatasets: z.array(evidenceDatasetKindSchema),
  extractorFamily: z.string().min(1),
  extractorVersion: z.string().min(1),
  expectedFactSchema: z.string().min(1),
  scoringRole: featureScoringRoleSchema,
  nullableOptional: z.boolean(),
  zeroEventSemantics: z.string().min(1),
  knownLimitations: z.array(z.string()),
  outputMetricOrExplanationField: z.string().min(1),
});
export type EvidenceAuditFeatureRegistryEntry = z.infer<
  typeof evidenceAuditFeatureRegistryEntrySchema
>;

export const evidenceAuditDimensionConsumptionSchema = z.object({
  dimension: z.enum(["PERFORMANCE", "SURVIVAL", "UTILITY", "EXPERIENCE"]),
  /** EXPERIENCE is OUT_OF_SCOPE for this WCL-backed audit PR. */
  auditScope: z.enum(["AUDITED", "OUT_OF_SCOPE", "NOT_AUDITED"]),
  computationPresent: z.boolean(),
  score: z.number().nullable(),
  confidence: z.number().nullable(),
  availabilityState: z.string().nullable(),
  inputFingerprint: z.string().nullable(),
  featureUsage: z.array(featureUsageEntrySchema),
  integrityErrors: z.array(z.string()),
});
export type EvidenceAuditDimensionConsumption = z.infer<
  typeof evidenceAuditDimensionConsumptionSchema
>;

export const evidenceAuditReplayResultSchema = z.object({
  deterministicMatch: z.boolean(),
  scoreMatch: z.boolean(),
  confidenceMatch: z.boolean(),
  availabilityMatch: z.boolean(),
  inputFingerprintMatch: z.boolean(),
  explanationMetricsFingerprintMatch: z.boolean(),
  providerCallCount: z.literal(0),
  details: z.array(z.string()),
});
export type EvidenceAuditReplayResult = z.infer<typeof evidenceAuditReplayResultSchema>;

export const evidenceAuditMatrixRowSchema = z.object({
  dungeonSlug: z.string().min(1),
  slotIndex: z.union([z.literal(0), z.literal(1)]),
  source: z.enum(["SELECTED", "MISSING", "INVALID", "OTHER"]),
  /** Compact WCL report identity for the selected slot. */
  wclSource: z.string().nullable(),
  datasets: slotAuditStateSchema,
  ranking: z.enum(["WRITTEN", "UNAVAILABLE", "FAILED", "NOT_ENABLED", "N/A"]),
  survivalFacts: z.enum(["OK", "PARTIAL", "UNAVAILABLE", "FAILED", "NOT_ENABLED", "N/A"]),
  utilityFacts: z.enum(["OK", "PARTIAL", "UNAVAILABLE", "FAILED", "NOT_ENABLED", "N/A"]),
  performance: z.enum(["OK", "PARTIAL", "UNAVAILABLE", "N/A"]),
  survival: z.enum(["OK", "PARTIAL", "UNAVAILABLE", "N/A"]),
  utility: z.enum(["OK", "PARTIAL", "UNAVAILABLE", "N/A"]),
  experience: z.literal("OUT_OF_SCOPE"),
  auditState: slotAuditStateSchema,
});
export type EvidenceAuditMatrixRow = z.infer<typeof evidenceAuditMatrixRowSchema>;

export const scoringV2EvidenceAuditDocumentSchema = z.object({
  schemaVersion: z.literal(EVIDENCE_AUDIT_V2_SCHEMA_VERSION),
  featureRegistryVersion: z.literal(FEATURE_REGISTRY_V2_VERSION),
  auditedAt: z.string().datetime(),
  manifestId: z.string().min(1),
  characterId: z.string().min(1),
  seasonId: z.string().min(1),
  manifestContentHash: z.string().min(1),
  expectedSlotCount: z.number().int().nonnegative(),
  selectedSlotCount: z.number().int().nonnegative(),
  coverageState: z.string().min(1),
  slots: z.array(evidenceAuditSlotSchema),
  featureRegistry: z.array(evidenceAuditFeatureRegistryEntrySchema),
  dimensionConsumption: z.array(evidenceAuditDimensionConsumptionSchema),
  matrix: z.array(evidenceAuditMatrixRowSchema),
  replay: evidenceAuditReplayResultSchema.nullable(),
  integrityFailures: z.array(z.string()),
  providerCallCount: z.literal(0),
});
export type ScoringV2EvidenceAuditDocument = z.infer<
  typeof scoringV2EvidenceAuditDocumentSchema
>;
