/**
 * Canonical Utility action timeline (scoring-neutral).
 * Scoring layers must consume these actions — never full raw WCL pages.
 */
import { sha256Hex } from "./sha256.js";
import { z } from "zod";
import { WCL_EVENT_NORMALIZER_VERSION } from "./wcl-event-normalizer-version.js";
import { WCL_DIGEST_FORBIDDEN_SCORE_KEYS } from "./wcl-run-source-digest.js";

export const UTILITY_ACTION_TIMELINE_SCHEMA_VERSION =
  "utility-action-timeline-v1" as const;
export const UTILITY_ACTION_NORMALIZER_VERSION =
  "utility-action-normalizer-v1" as const;

export const UTILITY_CAPABILITY_KEYS = [
  "UTILITY_INTERRUPTS",
  "UTILITY_DISPELS",
  "UTILITY_CROWD_CONTROL",
  "UTILITY_COMBAT_RES",
  "UTILITY_EXTERNAL_CASTS",
  "UTILITY_EXTERNAL_TARGET_CONTEXT",
] as const;
export type UtilityCapabilityKey = (typeof UTILITY_CAPABILITY_KEYS)[number];

export const utilityCategorySchema = z.enum([
  "INTERRUPT",
  "OFFENSIVE_DISPEL",
  "DEFENSIVE_DISPEL",
  "CROWD_CONTROL",
  "STOP",
  "COMBAT_RES",
  "EXTERNAL_SUPPORT",
  "OTHER_UTILITY",
]);
export type UtilityCategory = z.infer<typeof utilityCategorySchema>;

export const utilityActionOutcomeSchema = z.enum([
  "SUCCESS",
  "ATTEMPT",
  "UNKNOWN",
]);
export type UtilityActionOutcome = z.infer<typeof utilityActionOutcomeSchema>;

export const utilityCapabilityStatusSchema = z.enum([
  "COMPLETE",
  "INCOMPLETE",
  "UNAVAILABLE",
]);
export type UtilityCapabilityStatus = z.infer<typeof utilityCapabilityStatusSchema>;

export const utilityCapabilityCompletenessSchema = z.object({
  capability: z.enum(UTILITY_CAPABILITY_KEYS),
  status: utilityCapabilityStatusSchema,
  requiredDatasets: z.array(z.string()),
  presentDatasets: z.array(z.string()),
  incompleteDatasets: z.array(z.string()),
  limitations: z.array(z.string()),
});
export type UtilityCapabilityCompleteness = z.infer<
  typeof utilityCapabilityCompletenessSchema
>;

export const utilityCatalogGapRowSchema = z.object({
  spellId: z.number().int(),
  rawName: z.string().nullable(),
  sourceClassSlug: z.string().nullable(),
  sourceSpecSlug: z.string().nullable(),
  eventTypes: z.array(z.string()),
  datasets: z.array(z.string()),
  count: z.number().int().positive(),
  reason: z.literal("PROBABLE_UTILITY_CATALOG_GAP"),
});
export type UtilityCatalogGapRow = z.infer<typeof utilityCatalogGapRowSchema>;

export const utilityCanonicalActionSchema = z.object({
  canonicalActionId: z.string().min(1),
  abilityKey: z.string().min(1),
  canonicalName: z.string().min(1),
  primarySpellId: z.number().int(),
  observedSpellIds: z.array(z.number().int()).min(1),
  utilityCategory: utilityCategorySchema,
  reportCode: z.string().min(1),
  fightId: z.number().int().nonnegative(),
  reportRevision: z.number().int().nonnegative(),
  dungeonSlug: z.string().nullable(),
  rawTimestampMs: z.number(),
  fightOffsetMs: z.number().nonnegative(),
  sourceActorId: z.number().int(),
  ownerActorId: z.number().int(),
  targetActorId: z.number().int().nullable(),
  sourceCharacterName: z.string().min(1),
  targetCharacterName: z.string().nullable(),
  sourceClassSlug: z.string().nullable(),
  sourceSpecSlug: z.string().nullable(),
  sourceDataset: z.string().min(1),
  evidenceEventTypes: z.array(z.string()).min(1),
  outcome: utilityActionOutcomeSchema,
  attributedToPet: z.boolean(),
  petActorId: z.number().int().nullable(),
  limitations: z.array(z.string()),
  catalogVersion: z.string().min(1),
  normalizerVersion: z.string().min(1),
});
export type UtilityCanonicalAction = z.infer<typeof utilityCanonicalActionSchema>;

export const utilityParticipantSummarySchema = z.object({
  playerActorId: z.number().int().positive(),
  characterName: z.string().min(1),
  classSlug: z.string().nullable(),
  specSlug: z.string().nullable(),
  ownedPetActorIds: z.array(z.number().int()),
  rawCandidateEventCount: z.number().int().nonnegative(),
  canonicalActionCount: z.number().int().nonnegative(),
  countsByCategory: z.record(z.string(), z.number().int().nonnegative()),
  canonicalAbilityNames: z.array(z.string()),
  targets: z.array(
    z.object({
      targetActorId: z.number().int().nullable(),
      targetCharacterName: z.string().nullable(),
      actionCount: z.number().int().positive(),
    }),
  ),
  petAttributedActionCount: z.number().int().nonnegative(),
  unresolvedLikelyUtilityCount: z.number().int().nonnegative(),
  capabilityCompleteness: z.array(utilityCapabilityCompletenessSchema),
  limitations: z.array(z.string()),
});
export type UtilityParticipantSummary = z.infer<
  typeof utilityParticipantSummarySchema
>;

export const utilityActionTimelineV1Schema = z
  .object({
    schemaVersion: z.literal(UTILITY_ACTION_TIMELINE_SCHEMA_VERSION),
    sourceKey: z.object({
      reportCode: z.string().min(1),
      fightId: z.number().int().nonnegative(),
      reportRevision: z.number().int().nonnegative(),
    }),
    dungeonSlug: z.string().nullable(),
    keyLevel: z.number().int().nullable(),
    fightStartMs: z.number(),
    fightEndMs: z.number().nullable(),
    region: z.string().nullable(),
    participants: z.array(utilityParticipantSummarySchema).min(1).max(5),
    actions: z.array(utilityCanonicalActionSchema),
    countsByCategory: z.record(z.string(), z.number().int().nonnegative()),
    rawCandidateEventCount: z.number().int().nonnegative(),
    canonicalActionCount: z.number().int().nonnegative(),
    capabilityCompleteness: z.array(utilityCapabilityCompletenessSchema),
    unresolvedLikelyUtilityCandidates: z.array(utilityCatalogGapRowSchema),
    utilityCatalogGapSummary: z.array(utilityCatalogGapRowSchema),
    datasetCoverage: z.array(
      z.object({
        datasetKey: z.string().min(1),
        pageCount: z.number().int().nonnegative(),
        eventCount: z.number().int().nonnegative(),
        complete: z.boolean(),
        truncated: z.boolean(),
        stopReason: z.string().nullable(),
        coverageRatio: z.number().nullable(),
        selectionKind: z.string().optional(),
        scopeFingerprints: z.array(z.string()).optional(),
        selectionLimitations: z.array(z.string()).optional(),
      }),
    ),
    limitations: z.array(z.string()),
    catalogVersion: z.string().min(1),
    normalizerVersion: z.string().min(1),
    eventNormalizerVersion: z.literal(WCL_EVENT_NORMALIZER_VERSION),
    contentHash: z.string().min(16),
  })
  .strict();
export type UtilityActionTimelineV1 = z.infer<typeof utilityActionTimelineV1Schema>;

function assertNoForbiddenScoreKeys(value: unknown, path = "$"): void {
  if (value == null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoForbiddenScoreKeys(item, `${path}[${i}]`));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if ((WCL_DIGEST_FORBIDDEN_SCORE_KEYS as readonly string[]).includes(key)) {
      throw new Error(`utility_action_timeline_contains_forbidden_field:${key}`);
    }
    assertNoForbiddenScoreKeys(child, `${path}.${key}`);
  }
}

export function assertUtilityActionTimelineV1(value: unknown): UtilityActionTimelineV1 {
  assertNoForbiddenScoreKeys(value);
  return utilityActionTimelineV1Schema.parse(value);
}

export function hashUtilityActionTimelinePayload(value: unknown): string {
  const clone = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  delete clone.contentHash;
  return sha256Hex(JSON.stringify(clone));
}
