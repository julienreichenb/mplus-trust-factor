/**
 * ParticipantScoringDigestV1 — production scoring input for one actor in one fight.
 * Calculators consume digests only; never raw WCL event pages or provider clients.
 */
import { z } from "zod";
import { hashCanonicalJson } from "./canonical-json.js";
import { WCL_DIGEST_FORBIDDEN_SCORE_KEYS } from "./wcl-run-source-digest.js";
import {
  utilityCanonicalActionSchema,
  utilityCapabilityCompletenessSchema,
} from "./utility-action-timeline-v1.js";
import {
  pressureWindowV1Schema,
  survivalCanonicalActivationSchema,
  survivalCapabilityCompletenessSchema,
  survivalDeathEventSchema,
} from "./survival-action-timeline-v1.js";

export const PARTICIPANT_SCORING_DIGEST_SCHEMA_VERSION =
  "participant-scoring-digest-v1" as const;

/** Bump when digest field projection / extractor wiring changes. */
export const PARTICIPANT_DIGEST_EXTRACTOR_COMPAT_VERSION =
  "participant-digest-extractors-v3" as const;

export const participantDigestDimensionCompletenessSchema = z.enum([
  "COMPLETE",
  "PARTIAL",
  "UNAVAILABLE",
]);
export type ParticipantDigestDimensionCompleteness = z.infer<
  typeof participantDigestDimensionCompletenessSchema
>;

export const participantOffensiveActivationV1Schema = z.object({
  activationId: z.string().min(1),
  canonicalKey: z.string().min(1),
  primarySpellId: z.number().int(),
  /** WCL spell/effect IDs that contributed to this activation match. */
  observedSpellIds: z.array(z.number().int()).min(1),
  timestampMs: z.number(),
  fightOffsetMs: z.number().nonnegative().optional(),
  rawMatchedEventCount: z.number().int().nonnegative(),
  contributingSpellIds: z.array(z.number().int()),
  targetActorId: z.number().int().nullable().optional(),
});
export type ParticipantOffensiveActivationV1 = z.infer<
  typeof participantOffensiveActivationV1Schema
>;

/** Hostile NPC cast/begincast retained for Utility opportunity / density facts. */
export const participantHostileCastEventV1Schema = z.object({
  eventId: z.string().min(1),
  timestampMs: z.number(),
  fightOffsetMs: z.number().nonnegative(),
  spellId: z.number().int().nullable(),
  eventType: z.string().nullable(),
  sourceActorId: z.number().int().nullable(),
  targetActorId: z.number().int().nullable(),
});
export type ParticipantHostileCastEventV1 = z.infer<
  typeof participantHostileCastEventV1Schema
>;

export const participantLoadoutDigestV1Schema = z.object({
  evidenceState: z.enum(["PRESENT", "ABSENT", "UNPARSEABLE"]),
  talentSpellIds: z.array(z.number().int()),
  talentTreeNodeIds: z.array(z.number().int()).default([]),
  blizzardSpecId: z.number().int().nullable().optional(),
  source: z.enum(["COMBATANT_INFO", "ABSENT"]),
  /** Run-scoped race slug when CombatantInfo (or equivalent) proves it. */
  raceSlug: z.string().nullable().optional().default(null),
  raceEvidenceState: z.enum(["KNOWN", "UNKNOWN"]).default("UNKNOWN"),
});
export type ParticipantLoadoutDigestV1 = z.infer<
  typeof participantLoadoutDigestV1Schema
>;

export const participantPerformanceDigestV1Schema = z.object({
  parsePercentile: z.number().min(0).max(100).nullable(),
  parseSemantic: z.enum(["BRACKET_PERCENT", "RANK_PERCENT", "UNAVAILABLE"]),
  partition: z.number().int().nullable(),
  rawDps: z.number().nullable(),
  /** Provenance for the ranking/parse fact (never invented from event streams). */
  rankingProvenance: z
    .object({
      providerContractVersion: z.string().min(1),
      schemaVersion: z.string().min(1),
      artifactId: z.string().nullable(),
      contentHash: z.string().nullable(),
      source: z.enum(["PERSISTED_RANKING_PARSE", "ABSENT"]),
    })
    .optional(),
  offensiveActivations: z.array(participantOffensiveActivationV1Schema),
  /**
   * Run-level active combat clock for offensive cooldown cadence.
   * Distinct from Survival's damage-taken pressure clock.
   */
  activeCombatMs: z.number().int().nonnegative().nullable().optional(),
  activeCombatMethod: z
    .enum(["hostile_cast_activity", "fight_duration_fallback"])
    .nullable()
    .optional(),
  completeness: participantDigestDimensionCompletenessSchema,
  limitations: z.array(z.string()),
});
export type ParticipantPerformanceDigestV1 = z.infer<
  typeof participantPerformanceDigestV1Schema
>;

export const participantUtilityDigestV1Schema = z.object({
  actions: z.array(utilityCanonicalActionSchema),
  hostileCastEvents: z.array(participantHostileCastEventV1Schema).default([]),
  capabilityCompleteness: z.array(utilityCapabilityCompletenessSchema),
  completeness: participantDigestDimensionCompletenessSchema,
  limitations: z.array(z.string()),
});
export type ParticipantUtilityDigestV1 = z.infer<
  typeof participantUtilityDigestV1Schema
>;

export const participantSurvivalDigestV1Schema = z.object({
  damageTakenTotal: z.number().nonnegative(),
  damageTakenEventCount: z.number().int().nonnegative(),
  deaths: z.array(survivalDeathEventSchema),
  personalDefensiveActivations: z.array(survivalCanonicalActivationSchema),
  recoveryActivations: z.array(survivalCanonicalActivationSchema),
  externalsReceived: z.array(survivalCanonicalActivationSchema),
  pressureWindows: z.array(pressureWindowV1Schema),
  fightDurationMs: z.number().int().nonnegative().nullable(),
  activeCombatMs: z.number().int().nonnegative().nullable(),
  capabilityCompleteness: z.array(survivalCapabilityCompletenessSchema),
  completeness: participantDigestDimensionCompletenessSchema,
  limitations: z.array(z.string()),
});
export type ParticipantSurvivalDigestV1 = z.infer<
  typeof participantSurvivalDigestV1Schema
>;

/**
 * Durable identity slug: real value or null when absent.
 * Rejects empty/whitespace strings and the sentinel "unknown" (must be null instead).
 */
export const participantDigestIdentitySlugSchema = z
  .string()
  .trim()
  .min(1)
  .refine(
    (value) => value.toLowerCase() !== "unknown",
    { message: "participant_digest_identity_slug_must_not_be_unknown" },
  )
  .nullable();

export const participantScoringDigestV1Schema = z
  .object({
    schemaVersion: z.literal(PARTICIPANT_SCORING_DIGEST_SCHEMA_VERSION),
    reportCode: z.string().min(1),
    fightId: z.number().int().nonnegative(),
    reportRevision: z.number().int().nonnegative(),
    dungeonSlug: z.string().nullable(),
    keyLevel: z.number().int().positive().nullable(),
    timed: z.boolean().nullable(),
    runScore: z.number().nullable(),
    completedAt: z.string().datetime().nullable(),
    participantActorId: z.number().int().positive(),
    characterId: z.string().uuid().nullable(),
    characterName: z.string().min(1),
    realmSlug: participantDigestIdentitySlugSchema,
    regionCode: participantDigestIdentitySlugSchema,
    classSlug: z.string().nullable(),
    specSlug: z.string().nullable(),
    role: z.enum(["TANK", "HEALER", "DPS", "UNKNOWN"]).nullable(),
    ownedPetActorIds: z.array(z.number().int()),
    /** CombatantInfo talent/loadout proof for conditional cooldown eligibility. */
    loadoutEvidence: participantLoadoutDigestV1Schema.default({
      evidenceState: "ABSENT",
      talentSpellIds: [],
      talentTreeNodeIds: [],
      blizzardSpecId: null,
      source: "ABSENT",
      raceSlug: null,
      raceEvidenceState: "UNKNOWN",
    }),
    capabilityPackageArtifactId: z.string().min(1),
    capabilityPackageContentHash: z.string().min(16),
    catalogVersion: z.string().min(1),
    extractorCompatVersion: z.literal(PARTICIPANT_DIGEST_EXTRACTOR_COMPAT_VERSION),
    performance: participantPerformanceDigestV1Schema,
    utility: participantUtilityDigestV1Schema,
    survival: participantSurvivalDigestV1Schema,
    contentHash: z.string().min(16),
    createdAt: z.string().datetime(),
  })
  .strict();
export type ParticipantScoringDigestV1 = z.infer<
  typeof participantScoringDigestV1Schema
>;

/**
 * Durable uniqueness / lookup identity for a participant digest.
 * Independent from provider-package and score-result compatibility.
 */
export function buildParticipantDigestCompatibilityKey(input: {
  reportCode: string;
  fightId: number;
  reportRevision: number;
  participantActorId: number;
  digestSchemaVersion: string;
  extractorCompatVersion: string;
  capabilityPackageContentHash: string;
  catalogVersion: string;
}): string {
  return [
    "participant-scoring-digest",
    input.reportCode,
    `r${input.reportRevision}`,
    `f${input.fightId}`,
    `actor:${input.participantActorId}`,
    input.digestSchemaVersion,
    input.extractorCompatVersion,
    `pkg:${input.capabilityPackageContentHash}`,
    `catalog:${input.catalogVersion}`,
  ].join("|");
}

function assertNoForbiddenScoreKeys(value: unknown, path = "$"): void {
  if (value == null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoForbiddenScoreKeys(item, `${path}[${i}]`));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if ((WCL_DIGEST_FORBIDDEN_SCORE_KEYS as readonly string[]).includes(key)) {
      throw new Error(`participant_scoring_digest_forbidden_field:${key}`);
    }
    assertNoForbiddenScoreKeys(child, `${path}.${key}`);
  }
}

export function assertParticipantScoringDigestV1(
  value: unknown,
): ParticipantScoringDigestV1 {
  assertNoForbiddenScoreKeys(value);
  const parsed = participantScoringDigestV1Schema.parse(value);
  assertNoForbiddenScoreKeys(parsed);
  return parsed;
}

/**
 * Semantic hash projection for ParticipantScoringDigestV1 contentHash.
 *
 * Included: schema/extractor/catalog versions, fight + participant identity,
 * character identity fields, owned pets, package content hash, run metadata
 * (dungeon/key/timed/score/completedAt), and performance/utility/survival digests.
 *
 * Excluded (volatile storage / timing): contentHash, createdAt,
 * capabilityPackageArtifactId, rankingProvenance.artifactId.
 */
export function buildParticipantScoringDigestHashMaterial(
  digest: Omit<ParticipantScoringDigestV1, "contentHash">,
): unknown {
  const ranking = digest.performance.rankingProvenance;
  return {
    schemaVersion: digest.schemaVersion,
    reportCode: digest.reportCode,
    fightId: digest.fightId,
    reportRevision: digest.reportRevision,
    dungeonSlug: digest.dungeonSlug,
    keyLevel: digest.keyLevel,
    timed: digest.timed,
    runScore: digest.runScore,
    completedAt: digest.completedAt,
    participantActorId: digest.participantActorId,
    characterId: digest.characterId,
    characterName: digest.characterName,
    realmSlug: digest.realmSlug,
    regionCode: digest.regionCode,
    classSlug: digest.classSlug,
    specSlug: digest.specSlug,
    role: digest.role,
    ownedPetActorIds: digest.ownedPetActorIds,
    loadoutEvidence: digest.loadoutEvidence,
    capabilityPackageContentHash: digest.capabilityPackageContentHash,
    catalogVersion: digest.catalogVersion,
    extractorCompatVersion: digest.extractorCompatVersion,
    performance: {
      parsePercentile: digest.performance.parsePercentile,
      parseSemantic: digest.performance.parseSemantic,
      partition: digest.performance.partition,
      rawDps: digest.performance.rawDps,
      rankingProvenance: ranking
        ? {
            providerContractVersion: ranking.providerContractVersion,
            schemaVersion: ranking.schemaVersion,
            contentHash: ranking.contentHash,
            source: ranking.source,
          }
        : undefined,
      offensiveActivations: digest.performance.offensiveActivations.map(
        (activation) => ({
          activationId: activation.activationId,
          canonicalKey: activation.canonicalKey,
          primarySpellId: activation.primarySpellId,
          observedSpellIds: activation.observedSpellIds,
          timestampMs: activation.timestampMs,
          fightOffsetMs: activation.fightOffsetMs,
          rawMatchedEventCount: activation.rawMatchedEventCount,
          contributingSpellIds: activation.contributingSpellIds,
          targetActorId: activation.targetActorId ?? null,
        }),
      ),
      activeCombatMs: digest.performance.activeCombatMs ?? null,
      activeCombatMethod: digest.performance.activeCombatMethod ?? null,
      completeness: digest.performance.completeness,
      limitations: digest.performance.limitations,
    },
    utility: {
      actions: digest.utility.actions,
      hostileCastEvents: digest.utility.hostileCastEvents,
      capabilityCompleteness: digest.utility.capabilityCompleteness,
      completeness: digest.utility.completeness,
      limitations: digest.utility.limitations,
    },
    survival: {
      damageTakenTotal: digest.survival.damageTakenTotal,
      damageTakenEventCount: digest.survival.damageTakenEventCount,
      deaths: digest.survival.deaths,
      personalDefensiveActivations: digest.survival.personalDefensiveActivations,
      recoveryActivations: digest.survival.recoveryActivations,
      externalsReceived: digest.survival.externalsReceived,
      pressureWindows: digest.survival.pressureWindows,
      fightDurationMs: digest.survival.fightDurationMs,
      activeCombatMs: digest.survival.activeCombatMs,
      capabilityCompleteness: digest.survival.capabilityCompleteness,
      completeness: digest.survival.completeness,
      limitations: digest.survival.limitations,
    },
  };
}

/** @deprecated Prefer buildParticipantScoringDigestHashMaterial — kept for call-site compatibility. */
export function participantDigestHashPayload(
  digest: Omit<ParticipantScoringDigestV1, "contentHash">,
): unknown {
  return buildParticipantScoringDigestHashMaterial(digest);
}

export function hashParticipantScoringDigestPayload(value: unknown): string {
  return hashCanonicalJson(value);
}

export function withParticipantDigestContentHash(
  digest: Omit<ParticipantScoringDigestV1, "contentHash"> | Record<string, unknown>,
): ParticipantScoringDigestV1 {
  // Apply schema defaults (e.g. loadoutEvidence) before hashing.
  const provisional = assertParticipantScoringDigestV1({
    ...digest,
    contentHash: "0".repeat(64),
  });
  const { contentHash: _ignored, ...withoutHash } = provisional;
  void _ignored;
  const contentHash = hashCanonicalJson(
    buildParticipantScoringDigestHashMaterial(withoutHash),
  );
  return { ...withoutHash, contentHash };
}
