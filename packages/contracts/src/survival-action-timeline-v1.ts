/**
 * Canonical Survival action / pressure / participant contracts (scoring-neutral).
 * Scoring layers must consume these — never full raw WCL pages or score weights.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { WCL_EVENT_NORMALIZER_VERSION } from "./wcl-event-normalizer-version.js";
import { WCL_DIGEST_FORBIDDEN_SCORE_KEYS } from "./wcl-run-source-digest.js";

export const SURVIVAL_ACTION_TIMELINE_SCHEMA_VERSION =
  "survival-action-timeline-v1" as const;
export const PRESSURE_WINDOW_TIMELINE_SCHEMA_VERSION =
  "pressure-window-timeline-v1" as const;
export const PARTICIPANT_SURVIVAL_SUMMARY_SCHEMA_VERSION =
  "participant-survival-summary-v1" as const;
export const SURVIVAL_ACTION_NORMALIZER_VERSION =
  "survival-action-normalizer-v1" as const;
export const PRESSURE_WINDOW_DERIVATION_VERSION =
  "pressure-window-derivation-v1" as const;

export const SURVIVAL_REQUIRED_CAPABILITY_KEYS = [
  "SURVIVAL_DAMAGE_TAKEN",
  "SURVIVAL_DEATHS",
  "SURVIVAL_DEFENSIVE_ACTIVATIONS",
  "SURVIVAL_RECOVERY_ACTIVATIONS",
] as const;
export type SurvivalRequiredCapabilityKey =
  (typeof SURVIVAL_REQUIRED_CAPABILITY_KEYS)[number];

export const SURVIVAL_OPTIONAL_CONTEXT_CAPABILITY_KEYS = [
  "UTILITY_EXTERNAL_CASTS",
  "UTILITY_EXTERNAL_TARGET_CONTEXT",
  "PARTICIPANT_METADATA",
  "ACTOR_OWNERSHIP",
] as const;
export type SurvivalOptionalContextCapabilityKey =
  (typeof SURVIVAL_OPTIONAL_CONTEXT_CAPABILITY_KEYS)[number];

export const SURVIVAL_CAPABILITY_KEYS = [
  ...SURVIVAL_REQUIRED_CAPABILITY_KEYS,
  ...SURVIVAL_OPTIONAL_CONTEXT_CAPABILITY_KEYS,
] as const;
export type SurvivalCapabilityKey = (typeof SURVIVAL_CAPABILITY_KEYS)[number];

export const survivalActivationKindSchema = z.enum([
  "PERSONAL_DEFENSIVE",
  "RECOVERY",
  "EXTERNAL_DEFENSIVE_RECEIVED",
]);
export type SurvivalActivationKind = z.infer<typeof survivalActivationKindSchema>;

export const survivalActivationSourceSchema = z.enum([
  "CAST",
  "BUFF_APPLY",
  "CAST_AND_BUFF",
  "PET_CAST",
  "EXTERNAL_BUFF",
  "UNKNOWN",
]);
export type SurvivalActivationSource = z.infer<typeof survivalActivationSourceSchema>;

export const survivalDefensiveCategorySchema = z.enum([
  "DEFENSIVE_MAJOR",
  "DEFENSIVE_MINOR",
  "IMMUNITY",
  "SELF_HEAL",
  "CONSUMABLE",
  "EXTERNAL_DEFENSIVE",
]);
export type SurvivalDefensiveCategory = z.infer<typeof survivalDefensiveCategorySchema>;

export const survivalCapabilityStatusSchema = z.enum([
  "COMPLETE",
  "INCOMPLETE",
  "UNAVAILABLE",
]);
export type SurvivalCapabilityStatus = z.infer<typeof survivalCapabilityStatusSchema>;

export const survivalCapabilityCompletenessSchema = z.object({
  capability: z.enum(SURVIVAL_CAPABILITY_KEYS),
  status: survivalCapabilityStatusSchema,
  requiredDatasets: z.array(z.string()),
  presentDatasets: z.array(z.string()),
  incompleteDatasets: z.array(z.string()),
  limitations: z.array(z.string()),
});
export type SurvivalCapabilityCompleteness = z.infer<
  typeof survivalCapabilityCompletenessSchema
>;

export const survivalCatalogGapRowSchema = z.object({
  spellId: z.number().int(),
  rawName: z.string().nullable(),
  sourceClassSlug: z.string().nullable(),
  sourceSpecSlug: z.string().nullable(),
  eventTypes: z.array(z.string()),
  datasets: z.array(z.string()),
  count: z.number().int().positive(),
  evidenceTimestampsMs: z.array(z.number()).max(20),
  proposedCategory: z.enum([
    "PERSONAL_DEFENSIVE",
    "RECOVERY",
    "EXTERNAL_DEFENSIVE",
    "UNKNOWN",
  ]),
  proposedConfidence: z.enum(["LOW", "MEDIUM", "HIGH"]),
  reason: z.literal("PROBABLE_SURVIVAL_CATALOG_GAP"),
});
export type SurvivalCatalogGapRow = z.infer<typeof survivalCatalogGapRowSchema>;

export const survivalCanonicalActivationSchema = z.object({
  canonicalActivationId: z.string().min(1),
  abilityKey: z.string().min(1),
  canonicalName: z.string().min(1),
  primarySpellId: z.number().int(),
  observedSpellIds: z.array(z.number().int()).min(1),
  activationKind: survivalActivationKindSchema,
  defensiveCategory: survivalDefensiveCategorySchema,
  reportCode: z.string().min(1),
  fightId: z.number().int().nonnegative(),
  reportRevision: z.number().int().nonnegative(),
  participantActorId: z.number().int(),
  sourceActorId: z.number().int(),
  targetActorId: z.number().int().nullable(),
  casterActorId: z.number().int(),
  recipientActorId: z.number().int().nullable(),
  sourceCharacterName: z.string().min(1),
  targetCharacterName: z.string().nullable(),
  casterCharacterName: z.string().min(1),
  recipientCharacterName: z.string().nullable(),
  sourceClassSlug: z.string().nullable(),
  sourceSpecSlug: z.string().nullable(),
  rawTimestampMs: z.number(),
  fightOffsetMs: z.number().nonnegative(),
  activationSource: survivalActivationSourceSchema,
  sourceDataset: z.string().min(1),
  evidenceEventTypes: z.array(z.string()).min(1),
  evidenceEventIds: z.array(z.string()),
  attributedToPet: z.boolean(),
  petActorId: z.number().int().nullable(),
  /** External received by participant — credited to caster for Utility, not Survival usage. */
  creditsSurvivalUsageToRecipient: z.boolean(),
  creditsCasterForUtility: z.boolean(),
  relatedPressureWindowId: z.string().nullable(),
  responseRelation: z
    .enum([
      "BEFORE_PRESSURE",
      "DURING_PRESSURE",
      "AFTER_PRESSURE_RECOVERY",
      "UNRELATED",
      "EXTERNAL_RECEIVED",
    ])
    .nullable(),
  limitations: z.array(z.string()),
  catalogVersion: z.string().min(1),
  normalizerVersion: z.string().min(1),
});
export type SurvivalCanonicalActivation = z.infer<
  typeof survivalCanonicalActivationSchema
>;

export const survivalDeathEventSchema = z.object({
  deathEventId: z.string().min(1),
  participantActorId: z.number().int(),
  rawTimestampMs: z.number(),
  fightOffsetMs: z.number().nonnegative(),
  killingAbilitySpellId: z.number().int().nullable(),
  killingAbilityName: z.string().nullable(),
  sourceActorId: z.number().int().nullable(),
  evidenceEventId: z.string().min(1),
  relatedPressureWindowId: z.string().nullable(),
});
export type SurvivalDeathEvent = z.infer<typeof survivalDeathEventSchema>;

export const pressureWindowClassSchema = z.enum([
  "ISOLATED_DAMAGE",
  "SUSTAINED_PRESSURE",
  "FATAL_PRESSURE",
  "DEATH_WITHOUT_PRESSURE_CONTEXT",
]);
export type PressureWindowClass = z.infer<typeof pressureWindowClassSchema>;

export const pressureWindowDerivationFactsSchema = z.object({
  derivationVersion: z.literal(PRESSURE_WINDOW_DERIVATION_VERSION),
  configVersion: z.string().min(1),
  windowStartMs: z.number(),
  windowEndMs: z.number(),
  fightOffsetStartMs: z.number().nonnegative(),
  fightOffsetEndMs: z.number().nonnegative(),
  totalDamage: z.number().nonnegative(),
  hitCount: z.number().int().nonnegative(),
  peakHitDamage: z.number().nonnegative(),
  rollingWindowMs: z.number().int().positive(),
  rollingDamageSum: z.number().nonnegative(),
  maxHpUsed: z.number().positive().nullable(),
  rollingDamageRatioOfMaxHp: z.number().nullable(),
  peakHitRatioOfMaxHp: z.number().nullable(),
  sustainedByRollingThreshold: z.boolean(),
  sustainedByHitDensity: z.boolean(),
  isolatedByLowAbsoluteDamage: z.boolean(),
  evidenceEventIds: z.array(z.string()),
});
export type PressureWindowDerivationFacts = z.infer<
  typeof pressureWindowDerivationFactsSchema
>;

export const pressureWindowResponseClassificationSchema = z.object({
  defensivesBefore: z.array(z.string()),
  defensivesDuring: z.array(z.string()),
  recoveryAfter: z.array(z.string()),
  externalDefensivesReceived: z.array(z.string()),
  deathEventIds: z.array(z.string()),
  noPersonalDefensiveResponse: z.boolean(),
  noRecoveryResponse: z.boolean(),
});
export type PressureWindowResponseClassification = z.infer<
  typeof pressureWindowResponseClassificationSchema
>;

export const pressureWindowV1Schema = z.object({
  pressureWindowId: z.string().min(1),
  participantActorId: z.number().int(),
  characterName: z.string().min(1),
  windowClass: pressureWindowClassSchema,
  derivation: pressureWindowDerivationFactsSchema,
  response: pressureWindowResponseClassificationSchema,
  limitations: z.array(z.string()),
});
export type PressureWindowV1 = z.infer<typeof pressureWindowV1Schema>;

export const pressureWindowTimelineV1Schema = z
  .object({
    schemaVersion: z.literal(PRESSURE_WINDOW_TIMELINE_SCHEMA_VERSION),
    sourceKey: z.object({
      reportCode: z.string().min(1),
      fightId: z.number().int().nonnegative(),
      reportRevision: z.number().int().nonnegative(),
    }),
    derivationVersion: z.literal(PRESSURE_WINDOW_DERIVATION_VERSION),
    configVersion: z.string().min(1),
    capabilityEvidencePackageContentHash: z.string().min(16),
    windows: z.array(pressureWindowV1Schema),
    limitations: z.array(z.string()),
    contentHash: z.string().min(16),
  })
  .strict();
export type PressureWindowTimelineV1 = z.infer<typeof pressureWindowTimelineV1Schema>;

export const participantSurvivalSummaryV1Schema = z
  .object({
    schemaVersion: z.literal(PARTICIPANT_SURVIVAL_SUMMARY_SCHEMA_VERSION),
    reportCode: z.string().min(1),
    fightId: z.number().int().nonnegative(),
    reportRevision: z.number().int().nonnegative(),
    playerActorId: z.number().int().positive(),
    characterName: z.string().min(1),
    classSlug: z.string().nullable(),
    specSlug: z.string().nullable(),
    ownedPetActorIds: z.array(z.number().int()),
    damageTakenTotal: z.number().nonnegative(),
    damageTakenEventCount: z.number().int().nonnegative(),
    deathCount: z.number().int().nonnegative(),
    rawDefensiveEventCount: z.number().int().nonnegative(),
    canonicalPersonalDefensiveCount: z.number().int().nonnegative(),
    rawRecoveryEventCount: z.number().int().nonnegative(),
    canonicalRecoveryCount: z.number().int().nonnegative(),
    externalDefensiveReceivedCount: z.number().int().nonnegative(),
    pressureWindowCount: z.number().int().nonnegative(),
    sustainedPressureCount: z.number().int().nonnegative(),
    isolatedDamageCount: z.number().int().nonnegative(),
    noResponseWindowCount: z.number().int().nonnegative(),
    petAttributedActivationCount: z.number().int().nonnegative(),
    capabilityEvidencePackageContentHash: z.string().min(16),
    capabilityCompleteness: z.array(survivalCapabilityCompletenessSchema),
    limitations: z.array(z.string()),
    catalogVersion: z.string().min(1),
    normalizerVersion: z.string().min(1),
    contentHash: z.string().min(16),
  })
  .strict();
export type ParticipantSurvivalSummaryV1 = z.infer<
  typeof participantSurvivalSummaryV1Schema
>;

export const survivalActionTimelineV1Schema = z
  .object({
    schemaVersion: z.literal(SURVIVAL_ACTION_TIMELINE_SCHEMA_VERSION),
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
    capabilityEvidencePackageContentHash: z.string().min(16),
    capabilityEvidencePackageArtifactId: z.string().nullable(),
    participants: z.array(participantSurvivalSummaryV1Schema).min(1).max(5),
    activations: z.array(survivalCanonicalActivationSchema),
    deaths: z.array(survivalDeathEventSchema),
    pressureWindows: z.array(pressureWindowV1Schema),
    pressureTimeline: pressureWindowTimelineV1Schema,
    rawDefensiveEventCount: z.number().int().nonnegative(),
    canonicalPersonalDefensiveCount: z.number().int().nonnegative(),
    rawRecoveryEventCount: z.number().int().nonnegative(),
    canonicalRecoveryCount: z.number().int().nonnegative(),
    externalDefensiveReceivedCount: z.number().int().nonnegative(),
    capabilityCompleteness: z.array(survivalCapabilityCompletenessSchema),
    survivalCatalogGapSummary: z.array(survivalCatalogGapRowSchema),
    limitations: z.array(z.string()),
    catalogVersion: z.string().min(1),
    normalizerVersion: z.string().min(1),
    eventNormalizerVersion: z.literal(WCL_EVENT_NORMALIZER_VERSION),
    pressureDerivationVersion: z.literal(PRESSURE_WINDOW_DERIVATION_VERSION),
    pressureConfigVersion: z.string().min(1),
    contentHash: z.string().min(16),
  })
  .strict();
export type SurvivalActionTimelineV1 = z.infer<typeof survivalActionTimelineV1Schema>;

function assertNoForbiddenScoreKeys(value: unknown, path = "$"): void {
  if (value == null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoForbiddenScoreKeys(item, `${path}[${i}]`));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if ((WCL_DIGEST_FORBIDDEN_SCORE_KEYS as readonly string[]).includes(key)) {
      throw new Error(`survival_action_timeline_contains_forbidden_field:${key}`);
    }
    assertNoForbiddenScoreKeys(child, `${path}.${key}`);
  }
}

export function assertSurvivalActionTimelineV1(value: unknown): SurvivalActionTimelineV1 {
  assertNoForbiddenScoreKeys(value);
  return survivalActionTimelineV1Schema.parse(value);
}

export function assertPressureWindowTimelineV1(value: unknown): PressureWindowTimelineV1 {
  assertNoForbiddenScoreKeys(value);
  return pressureWindowTimelineV1Schema.parse(value);
}

export function assertParticipantSurvivalSummaryV1(
  value: unknown,
): ParticipantSurvivalSummaryV1 {
  assertNoForbiddenScoreKeys(value);
  return participantSurvivalSummaryV1Schema.parse(value);
}

export function hashSurvivalActionTimelinePayload(value: unknown): string {
  const clone = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  delete clone.contentHash;
  return createHash("sha256").update(JSON.stringify(clone)).digest("hex");
}

export function hashPressureWindowTimelinePayload(value: unknown): string {
  const clone = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  delete clone.contentHash;
  return createHash("sha256").update(JSON.stringify(clone)).digest("hex");
}

export function hashParticipantSurvivalSummaryPayload(value: unknown): string {
  const clone = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  delete clone.contentHash;
  return createHash("sha256").update(JSON.stringify(clone)).digest("hex");
}
