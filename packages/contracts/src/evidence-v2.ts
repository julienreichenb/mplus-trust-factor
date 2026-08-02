/**
 * Evidence Contract V2 — shared boundary between Workstream 02 (selector) and
 * Workstream 03 (discovery / hydration / acquisition execution).
 *
 * Lifecycle:
 * 1. WS03 supplies discovered/hydrated candidate metadata.
 * 2. WS02 builds immutable EvidenceAcquisitionPlanV2 (discovery identity,
 *    ordered candidates/fallbacks per slot, technical rejections).
 * 3. WS03 executes provider-aware acquisition from that plan (no policy).
 * 4. WS02 finalizes EvidenceManifestV2 after dataset/fact-set validation
 *    (frozen identity includes reportRevision).
 *
 * Do not freeze EvidenceManifestV2 before acquisition.
 */

import { z } from "zod";

export const EVIDENCE_MANIFEST_SCHEMA_VERSION = "2.0.0" as const;
export const EVIDENCE_ACQUISITION_PLAN_SCHEMA_VERSION = "2.0.0" as const;
export const EVIDENCE_SELECTOR_VERSION = "evidence-selector-v2.0.0" as const;
export const EVIDENCE_SLOTS_PER_DUNGEON = 2 as const;
/** Bounded fallback depth retained per dungeon on the acquisition plan. */
export const EVIDENCE_PLAN_MAX_CANDIDATES_PER_DUNGEON = 10 as const;

/** Discovery-time identity — plan stage. */
export const evidenceCandidateDiscoveryIdentitySchema = z.object({
  reportCode: z.string().min(1).max(64),
  fightId: z.number().int().nonnegative(),
});
export type EvidenceCandidateDiscoveryIdentity = z.infer<
  typeof evidenceCandidateDiscoveryIdentitySchema
>;

/** Final frozen identity — manifest stage only. */
export const evidenceCandidateFrozenIdentitySchema = z.object({
  reportCode: z.string().min(1).max(64),
  fightId: z.number().int().nonnegative(),
  reportRevision: z.number().int().nonnegative(),
});
export type EvidenceCandidateFrozenIdentity = z.infer<
  typeof evidenceCandidateFrozenIdentitySchema
>;

/**
 * Frozen evidence role. UNKNOWN is explicit — never silently coerced to DPS.
 * Stored on JSON acquisition plans/manifests only (not Prisma CharacterRole).
 */
export const evidenceRoleSchema = z.enum(["DPS", "TANK", "HEALER", "UNKNOWN"]);
export type EvidenceRole = z.infer<typeof evidenceRoleSchema>;

/** Season / class / spec / role scope for one selection. */
export const evidenceSelectionScopeSchema = z.object({
  characterId: z.string().min(1),
  seasonId: z.string().min(1),
  seasonSlug: z.string().min(1),
  specializationId: z.string().min(1).nullable(),
  /** Frozen class slug for catalog-dependent extractors; null = unknown. */
  classSlug: z.string().min(1).nullable().optional().default(null),
  specSlug: z.string().min(1).nullable(),
  role: evidenceRoleSchema,
  refreshContractHash: z.string().min(1),
  selectorVersion: z.string().min(1),
  evidenceCutoffAt: z.string().datetime(),
  highKeyPolicyId: z.string().min(1),
  activeDungeonSlugs: z.array(z.string().min(1)).min(1),
});
export type EvidenceSelectionScope = z.infer<typeof evidenceSelectionScopeSchema>;

/**
 * Access / incompleteness diagnostics — produced by WS03, read by WS02.
 * Never used as ordering keys beyond eligibility gates.
 */
export const evidenceAccessStateSchema = z.enum([
  "PUBLIC",
  "PRIVATE_OR_HIDDEN",
  "ARCHIVED_OR_GATED",
  "RATE_DEFERRED",
  "SCHEMA_UNSUPPORTED",
  "UNKNOWN",
]);
export type EvidenceAccessState = z.infer<typeof evidenceAccessStateSchema>;

export const evidenceIdentityResolutionSchema = z.enum([
  "RESOLVED",
  "UNRESOLVED",
  "WRONG_SPEC",
  "WRONG_SEASON",
  "WRONG_DUNGEON",
]);
export type EvidenceIdentityResolution = z.infer<typeof evidenceIdentityResolutionSchema>;

/**
 * Forbidden from ordering. May be attached for diagnostics / probes only.
 * Selector implementations MUST ignore these fields.
 */
export const evidenceCandidateDiagnosticsOnlySchema = z.object({
  parsePercentile: z.number().nullable().optional(),
  deaths: z.number().nullable().optional(),
  utilityActions: z.number().nullable().optional(),
  expectedLabel: z.string().nullable().optional(),
});
export type EvidenceCandidateDiagnosticsOnly = z.infer<
  typeof evidenceCandidateDiagnosticsOnlySchema
>;

/**
 * Factual candidate metadata after WS03 discovery (± hydration).
 * Plan stage uses discovery identity; reportRevision may still be null.
 */
export const evidenceCandidateMetadataV2Schema = z.object({
  discoveryIdentity: evidenceCandidateDiscoveryIdentitySchema,
  /** Optional at plan time; required to freeze a selected manifest slot. */
  reportRevision: z.number().int().nonnegative().nullable(),
  dungeonSlug: z.string().min(1),
  keyLevel: z.number().int().positive(),
  /** Unknown timer retained as null — not a hard reject by itself. */
  timed: z.boolean().nullable(),
  /** Comparable canonical run score when available; null sorts last. */
  runScore: z.number().nullable(),
  /** 0..1 technical completeness for ordering (not behavior/parse). */
  evidenceCompleteness: z.number().min(0).max(1),
  completedAt: z.string().datetime().nullable(),
  fightDurationMs: z.number().int().positive().nullable(),
  actorId: z.number().int().nonnegative().nullable(),
  accessState: evidenceAccessStateSchema,
  identityResolution: evidenceIdentityResolutionSchema,
  fightAccessible: z.boolean(),
  hardError: z.boolean(),
  discoverySource: z.string().min(1).max(64).optional(),
  diagnosticsOnly: evidenceCandidateDiagnosticsOnlySchema.optional(),
});
export type EvidenceCandidateMetadataV2 = z.infer<typeof evidenceCandidateMetadataV2Schema>;

export const candidateRejectionReasonSchema = z.enum([
  "HIDDEN_OR_PRIVATE",
  "ARCHIVED_OR_GATED",
  "IDENTITY_UNRESOLVED",
  "WRONG_SEASON",
  "WRONG_SPEC",
  "WRONG_DUNGEON",
  "DUPLICATE_REPORT_FIGHT",
  "MISSING_KEY_LEVEL",
  "INVALID_DURATION",
  "MISSING_REPORT_REVISION",
  "HARD_PROVIDER_ERROR",
  "SCHEMA_UNSUPPORTED",
  "RATE_DEFERRED",
  "OFF_POOL_DUNGEON",
  "AFTER_CUTOFF",
  "NOT_SELECTED_CAPACITY",
  "ACQUISITION_FAILED",
  "DATASET_INVALID",
  "FACT_SET_INVALID",
  "FALLBACK_EXHAUSTED",
]);
export type CandidateRejectionReason = z.infer<typeof candidateRejectionReasonSchema>;

export const candidateRejectionSummarySchema = z.object({
  reportCode: z.string().min(1),
  fightId: z.number().int().nonnegative(),
  reportRevision: z.number().int().nonnegative().nullable(),
  dungeonSlug: z.string().nullable(),
  reason: candidateRejectionReasonSchema,
  detail: z.string().nullable(),
});
export type CandidateRejectionSummary = z.infer<typeof candidateRejectionSummarySchema>;

export const evidenceSlotStateSchema = z.enum([
  "SELECTED",
  "MISSING_NO_CANDIDATE",
  "MISSING_PRIVATE_OR_HIDDEN",
  "MISSING_ARCHIVED_OR_GATED",
  "MISSING_IDENTITY_UNRESOLVED",
  "MISSING_SCHEMA_UNSUPPORTED",
  "MISSING_RATE_DEFERRED",
]);
export type EvidenceSlotState = z.infer<typeof evidenceSlotStateSchema>;

export const dimensionValidityStateSchema = z.enum(["VALID", "PARTIAL", "INVALID"]);
export type DimensionValidityState = z.infer<typeof dimensionValidityStateSchema>;

export const dimensionValiditySchema = z.object({
  performance: dimensionValidityStateSchema,
  survival: dimensionValidityStateSchema,
  utility: dimensionValidityStateSchema,
  reasons: z.array(z.string()),
});
export type DimensionValidity = z.infer<typeof dimensionValiditySchema>;

export const evidenceDatasetKindSchema = z.enum([
  "RANKING_PARSE",
  "MASTER_DATA",
  "CASTS",
  "HOSTILE_CASTS",
  "INTERRUPTS",
  "DEATHS",
  "DAMAGE_TAKEN",
  "BUFFS",
  "DEBUFFS",
  "DISPELS",
  "HEALING",
  "COMBATANT_INFO",
  "DAMAGE_DONE",
]);
export type EvidenceDatasetKind = z.infer<typeof evidenceDatasetKindSchema>;

export const evidenceConsumerDimensionSchema = z.enum([
  "PERFORMANCE",
  "SURVIVAL",
  "UTILITY",
]);
export type EvidenceConsumerDimension = z.infer<typeof evidenceConsumerDimensionSchema>;

/**
 * Cost estimate: unknown is distinct from zero.
 * WS03 may annotate execution costs; WS02 does not invent acquisition policy from cost.
 */
export const evidenceCostEstimateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("KNOWN"), points: z.number().nonnegative() }),
  z.object({ kind: z.literal("UNKNOWN") }),
  z.object({ kind: z.literal("ZERO_CACHE_HIT") }),
]);
export type EvidenceCostEstimate = z.infer<typeof evidenceCostEstimateSchema>;

export const evidenceDatasetHashSchema = z.object({
  dataset: evidenceDatasetKindSchema,
  contentHash: z.string().min(1),
});
export type EvidenceDatasetHash = z.infer<typeof evidenceDatasetHashSchema>;

/** Ordered acquisition attempt on a desired slot (discovery identity only). */
export const evidenceAcquisitionCandidateRefSchema = z.object({
  discoveryIdentity: evidenceCandidateDiscoveryIdentitySchema,
  rank: z.number().int().nonnegative(),
  keyLevel: z.number().int().positive(),
  timed: z.boolean().nullable(),
  runScore: z.number().nullable(),
  evidenceCompleteness: z.number().min(0).max(1),
  completedAt: z.string().datetime().nullable(),
  actorId: z.number().int().nonnegative().nullable(),
});
export type EvidenceAcquisitionCandidateRef = z.infer<
  typeof evidenceAcquisitionCandidateRefSchema
>;

export const evidenceAcquisitionSlotPlanV2Schema = z.object({
  slotId: z.string().min(1),
  dungeonSlug: z.string().min(1),
  slotIndex: z.union([z.literal(0), z.literal(1)]),
  /** Preferred candidate first, then fallbacks. Empty ⇒ provisional missing. */
  orderedCandidates: z.array(evidenceAcquisitionCandidateRefSchema),
  provisionalMissingState: evidenceSlotStateSchema.nullable(),
});
export type EvidenceAcquisitionSlotPlanV2 = z.infer<
  typeof evidenceAcquisitionSlotPlanV2Schema
>;

export const evidenceSelectorDiagnosticsV2Schema = z.object({
  candidatesConsidered: z.number().int().nonnegative(),
  candidatesEligible: z.number().int().nonnegative(),
  candidatesRejected: z.number().int().nonnegative(),
  rejectionReasonCounts: z.record(z.string(), z.number().int().nonnegative()),
  perDungeon: z.array(
    z.object({
      dungeonSlug: z.string().min(1),
      eligibleCount: z.number().int().nonnegative(),
      plannedAttemptCount: z.number().int().nonnegative(),
      provisionalMissingStates: z.array(evidenceSlotStateSchema),
    }),
  ),
});
export type EvidenceSelectorDiagnosticsV2 = z.infer<
  typeof evidenceSelectorDiagnosticsV2Schema
>;

/**
 * EvidenceAcquisitionPlanV2 — immutable WS02 selection policy for acquisition.
 * Uses discovery identity only. WS03 executes; must not invent ordering/fallbacks.
 */
export const evidenceAcquisitionPlanV2Schema = z.object({
  schemaVersion: z.literal(EVIDENCE_ACQUISITION_PLAN_SCHEMA_VERSION),
  selectorVersion: z.string().min(1),
  characterId: z.string().min(1),
  seasonId: z.string().min(1),
  seasonSlug: z.string().min(1),
  /** Frozen at plan time; optional for backward-compatible parse of older plans. */
  classSlug: z.string().nullable().optional().default(null),
  specSlug: z.string().nullable(),
  role: evidenceRoleSchema,
  refreshContractHash: z.string().min(1),
  evidenceCutoffAt: z.string().datetime(),
  highKeyPolicyId: z.string().min(1),
  activeDungeonSlugs: z.array(z.string().min(1)),
  expectedSlotCount: z.number().int().nonnegative(),
  plannedAt: z.string().datetime(),
  slots: z.array(evidenceAcquisitionSlotPlanV2Schema),
  rejectedCandidates: z.array(candidateRejectionSummarySchema),
  diagnostics: evidenceSelectorDiagnosticsV2Schema,
  contentHash: z.string().min(1),
});
export type EvidenceAcquisitionPlanV2 = z.infer<typeof evidenceAcquisitionPlanV2Schema>;

/** Canonical plan hash input — excludes wall-clock `plannedAt`. */
export const evidenceAcquisitionPlanContentHashInputSchema = z.object({
  schemaVersion: z.literal(EVIDENCE_ACQUISITION_PLAN_SCHEMA_VERSION),
  selectorVersion: z.string().min(1),
  characterId: z.string().min(1),
  seasonId: z.string().min(1),
  seasonSlug: z.string().min(1),
  classSlug: z.string().nullable(),
  specSlug: z.string().nullable(),
  role: evidenceRoleSchema,
  refreshContractHash: z.string().min(1),
  evidenceCutoffAt: z.string().datetime(),
  highKeyPolicyId: z.string().min(1),
  activeDungeonSlugs: z.array(z.string().min(1)),
  expectedSlotCount: z.number().int().nonnegative(),
  slots: z.array(evidenceAcquisitionSlotPlanV2Schema),
  rejectedCandidates: z.array(candidateRejectionSummarySchema),
});
export type EvidenceAcquisitionPlanContentHashInput = z.infer<
  typeof evidenceAcquisitionPlanContentHashInputSchema
>;

/**
 * Per-candidate acquisition + validation outcome from WS03 execution.
 * Fed into WS02 finalization; must not reorder plan policy.
 */
export const evidenceCandidateAcquisitionResultSchema = z.object({
  discoveryIdentity: evidenceCandidateDiscoveryIdentitySchema,
  acquisitionStatus: z.enum(["ACQUIRED", "REJECTED"]),
  reportRevision: z.number().int().nonnegative().nullable(),
  rejectionReason: candidateRejectionReasonSchema.nullable(),
  rejectionDetail: z.string().nullable(),
  datasetHashes: z.array(evidenceDatasetHashSchema),
  factSetHash: z.string().min(1).nullable(),
  dimensionValidity: dimensionValiditySchema.nullable(),
  keyLevel: z.number().int().positive().nullable().optional(),
  timed: z.boolean().nullable().optional(),
  runScore: z.number().nullable().optional(),
  completedAt: z.string().datetime().nullable().optional(),
  actorId: z.number().int().nonnegative().nullable().optional(),
  evidenceCompleteness: z.number().min(0).max(1).nullable().optional(),
});
export type EvidenceCandidateAcquisitionResult = z.infer<
  typeof evidenceCandidateAcquisitionResultSchema
>;

export const evidenceSlotV2Schema = z.object({
  slotId: z.string().min(1),
  dungeonSlug: z.string().min(1),
  slotIndex: z.union([z.literal(0), z.literal(1)]),
  state: evidenceSlotStateSchema,
  identity: evidenceCandidateFrozenIdentitySchema.nullable(),
  keyLevel: z.number().int().positive().nullable(),
  timed: z.boolean().nullable(),
  runScore: z.number().nullable(),
  completedAt: z.string().datetime().nullable(),
  actorId: z.number().int().nonnegative().nullable(),
  dimensionValidity: dimensionValiditySchema.nullable(),
  /** Rank within the slot plan that filled the slot; null when missing. */
  selectedRank: z.number().int().nonnegative().nullable(),
  /** Why the preferred (rank 0) candidate was not used, when applicable. */
  fallbackReason: z.string().nullable(),
  datasetHashes: z.array(evidenceDatasetHashSchema).nullable(),
  factSetHash: z.string().min(1).nullable(),
});
export type EvidenceSlotV2 = z.infer<typeof evidenceSlotV2Schema>;

export const evidenceCoverageStateSchema = z.enum([
  "FULL",
  "STRONG",
  "PARTIAL",
  "INSUFFICIENT",
]);
export type EvidenceCoverageState = z.infer<typeof evidenceCoverageStateSchema>;

export const evidenceCoverageV2Schema = z.object({
  state: evidenceCoverageStateSchema,
  expectedSlotCount: z.number().int().nonnegative(),
  selectedSlotCount: z.number().int().nonnegative(),
  dungeonCount: z.number().int().nonnegative(),
  dungeonsRepresented: z.number().int().nonnegative(),
  slotFillRatio: z.number().min(0).max(1),
  dungeonFillRatio: z.number().min(0).max(1),
});
export type EvidenceCoverageV2 = z.infer<typeof evidenceCoverageV2Schema>;

export const characterSeasonEvidenceManifestV2Schema = z.object({
  schemaVersion: z.literal(EVIDENCE_MANIFEST_SCHEMA_VERSION),
  selectorVersion: z.string().min(1),
  characterId: z.string().min(1),
  seasonId: z.string().min(1),
  seasonSlug: z.string().min(1),
  /** Frozen class slug; optional for backward-compatible parse of older manifests. */
  classSlug: z.string().nullable().optional().default(null),
  specSlug: z.string().nullable(),
  role: evidenceRoleSchema,
  refreshContractHash: z.string().min(1),
  evidenceCutoffAt: z.string().datetime(),
  highKeyPolicyId: z.string().min(1),
  activeDungeonSlugs: z.array(z.string().min(1)),
  expectedSlotCount: z.number().int().nonnegative(),
  selectedSlotCount: z.number().int().nonnegative(),
  selectedAt: z.string().datetime(),
  acquisitionPlanContentHash: z.string().min(1),
  slots: z.array(evidenceSlotV2Schema),
  rejectedCandidates: z.array(candidateRejectionSummarySchema),
  coverage: evidenceCoverageV2Schema,
  contentHash: z.string().min(1),
  diagnostics: evidenceSelectorDiagnosticsV2Schema,
});
export type CharacterSeasonEvidenceManifestV2 = z.infer<
  typeof characterSeasonEvidenceManifestV2Schema
>;

/**
 * Canonical manifest content-hash input. Excludes wall-clock `selectedAt` and
 * aggregate diagnostics tallies that are derivable from slots/rejections.
 */
export const evidenceManifestContentHashInputSchema = z.object({
  schemaVersion: z.literal(EVIDENCE_MANIFEST_SCHEMA_VERSION),
  selectorVersion: z.string().min(1),
  characterId: z.string().min(1),
  seasonId: z.string().min(1),
  seasonSlug: z.string().min(1),
  classSlug: z.string().nullable(),
  specSlug: z.string().nullable(),
  role: evidenceRoleSchema,
  refreshContractHash: z.string().min(1),
  evidenceCutoffAt: z.string().datetime(),
  highKeyPolicyId: z.string().min(1),
  activeDungeonSlugs: z.array(z.string().min(1)),
  expectedSlotCount: z.number().int().nonnegative(),
  selectedSlotCount: z.number().int().nonnegative(),
  acquisitionPlanContentHash: z.string().min(1),
  slots: z.array(evidenceSlotV2Schema),
  rejectedCandidates: z.array(candidateRejectionSummarySchema),
  coverage: evidenceCoverageV2Schema,
});
export type EvidenceManifestContentHashInput = z.infer<
  typeof evidenceManifestContentHashInputSchema
>;

export function expectedEvidenceSlotCount(activeDungeonCount: number): number {
  if (!Number.isInteger(activeDungeonCount) || activeDungeonCount < 0) {
    throw new RangeError(`activeDungeonCount must be a non-negative integer, got ${activeDungeonCount}`);
  }
  return activeDungeonCount * EVIDENCE_SLOTS_PER_DUNGEON;
}

export function discoveryIdentityKey(
  identity: EvidenceCandidateDiscoveryIdentity,
): string {
  return `${identity.reportCode}:${identity.fightId}`;
}

export function frozenIdentityKey(identity: EvidenceCandidateFrozenIdentity): string {
  return `${identity.reportCode}:${identity.fightId}:${identity.reportRevision}`;
}

export function sumEvidenceCostEstimates(
  estimates: readonly EvidenceCostEstimate[],
): EvidenceCostEstimate {
  let points = 0;
  let sawKnown = false;
  for (const estimate of estimates) {
    if (estimate.kind === "UNKNOWN") return { kind: "UNKNOWN" };
    if (estimate.kind === "KNOWN") {
      sawKnown = true;
      points += estimate.points;
    }
  }
  if (!sawKnown && estimates.every((e) => e.kind === "ZERO_CACHE_HIT")) {
    return { kind: "ZERO_CACHE_HIT" };
  }
  return { kind: "KNOWN", points };
}
