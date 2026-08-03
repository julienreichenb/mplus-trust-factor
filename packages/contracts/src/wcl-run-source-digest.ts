/**
 * Permanent scoring-neutral WCL run digest contracts.
 * Digest documents must never contain scores, grades, weights, or calculator outputs.
 */
import { z } from "zod";

export const WCL_RUN_SOURCE_DIGEST_SCHEMA_VERSION = "wcl-run-source-digest-v1" as const;
export const WCL_RAW_PAGE_RETENTION_DAYS = 30 as const;

export const wclParticipantMappingStateSchema = z.enum([
  "UNRESOLVED",
  "RESOLVED",
  "AMBIGUOUS",
  "CONFLICT",
]);
export type WclParticipantMappingState = z.infer<typeof wclParticipantMappingStateSchema>;

export const wclRunDigestParticipantSchema = z.object({
  wclActorId: z.number().int(),
  wclCanonicalId: z.string().nullable(),
  characterName: z.string().min(1),
  realmSlug: z.string().min(1),
  regionCode: z.string().min(1),
  classSlug: z.string().nullable(),
  specSlug: z.string().nullable(),
  role: z.string().nullable(),
  ownedPetActorIds: z.array(z.number().int()).default([]),
});
export type WclRunDigestParticipant = z.infer<typeof wclRunDigestParticipantSchema>;

export const wclRunDigestDatasetSummarySchema = z.object({
  datasetKey: z.string().min(1),
  schemaVersion: z.string().min(1),
  providerContractVersion: z.string().min(1),
  pageCount: z.number().int().nonnegative(),
  eventCount: z.number().int().nonnegative(),
  truncated: z.boolean(),
  payloadFingerprint: z.string().nullable(),
  pageContentHashes: z.array(z.string()).default([]),
});
export type WclRunDigestDatasetSummary = z.infer<typeof wclRunDigestDatasetSummarySchema>;

/** Forbidden keys that must never appear in a neutral source digest. */
export const WCL_DIGEST_FORBIDDEN_SCORE_KEYS = [
  "score",
  "scores",
  "grade",
  "grades",
  "weight",
  "weights",
  "threshold",
  "thresholds",
  "penalty",
  "penalties",
  "opportunity",
  "opportunities",
  "dimensionScore",
  "overallScore",
  "confidence",
  "explanation",
  "calculator",
] as const;

export const wclRunSourceDigestDocumentSchema = z
  .object({
    schemaVersion: z.literal(WCL_RUN_SOURCE_DIGEST_SCHEMA_VERSION),
    providerContractVersion: z.string().min(1),
    reportCode: z.string().min(1),
    fightId: z.number().int().nonnegative(),
    reportRevision: z.number().int().nonnegative(),
    region: z.string().nullable(),
    dungeonSlug: z.string().nullable(),
    dungeonEncounterId: z.number().int().nullable().optional(),
    zoneId: z.number().int().nullable().optional(),
    keyLevel: z.number().int().positive().nullable(),
    timerLimitMs: z.number().int().positive().nullable().optional(),
    elapsedMs: z.number().int().nonnegative().nullable().optional(),
    timed: z.boolean().nullable(),
    startTimeMs: z.number().nullable().optional(),
    endTimeMs: z.number().nullable().optional(),
    visibilityState: z.string().min(1),
    completenessState: z.string().min(1),
    acquiredAt: z.string().datetime(),
    participants: z.array(wclRunDigestParticipantSchema).max(16),
    datasets: z.array(wclRunDigestDatasetSummarySchema),
  })
  .strict();
export type WclRunSourceDigestDocument = z.infer<typeof wclRunSourceDigestDocumentSchema>;

/** Fail-closed check that a digest payload has no model/score semantics. */
export function assertNeutralWclRunDigest(value: unknown): WclRunSourceDigestDocument {
  const parsed = wclRunSourceDigestDocumentSchema.parse(value);
  const serialized = JSON.stringify(parsed).toLowerCase();
  for (const key of WCL_DIGEST_FORBIDDEN_SCORE_KEYS) {
    // Allow "confidence" only as substring of mappingConfidence-style words — use word boundaries.
    const re = new RegExp(`"${key}"\\s*:`, "i");
    if (re.test(serialized)) {
      throw new Error(`wcl_run_source_digest_contains_forbidden_field:${key}`);
    }
  }
  return parsed;
}

export const evidenceDatasetPageIdentitySchema = z.object({
  reportCode: z.string().min(1),
  fightId: z.number().int().nonnegative(),
  reportRevision: z.number().int().nonnegative(),
  datasetKey: z.string().min(1),
  pageIndex: z.number().int().nonnegative(),
  providerContractVersion: z.string().min(1),
  schemaVersion: z.string().min(1),
  pageCursor: z.string().nullable().optional(),
});
export type EvidenceDatasetPageIdentity = z.infer<typeof evidenceDatasetPageIdentitySchema>;

export function buildEvidenceDatasetPageIdentityKey(
  identity: EvidenceDatasetPageIdentity,
): string {
  return [
    identity.reportCode,
    String(identity.fightId),
    String(identity.reportRevision),
    identity.datasetKey,
    String(identity.pageIndex),
    identity.providerContractVersion,
    identity.schemaVersion,
  ].join("|");
}
