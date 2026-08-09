/**
 * Capability-scoped shared WCL evidence contracts (scoring-neutral).
 * One run/revision is acquired once; participants reference the same package.
 */
import { sha256Hex } from "./sha256.js";
import { z } from "zod";
import { WCL_DIGEST_FORBIDDEN_SCORE_KEYS } from "./wcl-run-source-digest.js";

export const CAPABILITY_ACQUISITION_PLAN_VERSION =
  "capability-acquisition-plan-v2" as const;
export const CAPABILITY_EVIDENCE_PACKAGE_SCHEMA_VERSION =
  "capability-evidence-package-v4" as const;
export const WCL_GRAPHQL_QUERY_VERSION = "wcl-graphql-v2-events" as const;

export const EVIDENCE_CAPABILITIES = [
  "PERFORMANCE_OFFENSIVE_ACTIVATIONS",
  "SURVIVAL_DEFENSIVE_ACTIVATIONS",
  "SURVIVAL_RECOVERY_ACTIVATIONS",
  "SURVIVAL_DAMAGE_TAKEN",
  "SURVIVAL_DEATHS",
  "UTILITY_INTERRUPTS",
  "UTILITY_DISPELS",
  "UTILITY_CROWD_CONTROL",
  "UTILITY_EXTERNAL_CASTS",
  "UTILITY_EXTERNAL_TARGET_CONTEXT",
  "UTILITY_HOSTILE_CASTS",
  "PARTICIPANT_METADATA",
  "ACTOR_OWNERSHIP",
] as const;

export type EvidenceCapability = (typeof EVIDENCE_CAPABILITIES)[number];

export const evidenceCapabilitySchema = z.enum(EVIDENCE_CAPABILITIES);

export const ACQUISITION_MODES = [
  "PRODUCTION_CAPABILITY_ACQUISITION",
  "PROBE_DISCOVERY_ACQUISITION",
] as const;
export type AcquisitionMode = (typeof ACQUISITION_MODES)[number];

export const ARTIFACT_RETENTION_CLASSES = [
  "EPHEMERAL_RAW_PAGE",
  "PINNED_DIAGNOSTIC",
  "CANONICAL_CAPABILITY_EVIDENCE",
] as const;
export type ArtifactRetentionClass = (typeof ARTIFACT_RETENTION_CLASSES)[number];

export const capabilityPaginationStopReasonSchema = z.enum([
  "NEXT_PAGE_NULL",
  "CURSOR_REACHED_FIGHT_END",
  "MAX_PAGES",
  "NON_PROGRESSING_CURSOR",
  "EMPTY_PAGE",
  "GRAPHQL_ERROR",
  "FILTER_BATCH_FAILED",
  "MISSING_REQUIRED_BATCH",
  "FIGHT_BOUNDS_NOT_RESPECTED",
]);
export type CapabilityPaginationStopReason = z.infer<
  typeof capabilityPaginationStopReasonSchema
>;

export const capabilityCoverageV1Schema = z.object({
  capability: evidenceCapabilitySchema,
  requiredDatasets: z.array(z.string().min(1)).min(1),
  filterIdentity: z.string().min(1),
  pageCount: z.number().int().nonnegative(),
  eventCount: z.number().int().nonnegative(),
  firstTimestampMs: z.number().nullable(),
  lastTimestampMs: z.number().nullable(),
  nextPageTimestamp: z.number().nullable(),
  stopReason: capabilityPaginationStopReasonSchema.nullable(),
  complete: z.boolean(),
  limitations: z.array(z.string()),
  sourceArtifactIds: z.array(z.string()),
});
export type CapabilityCoverageV1 = z.infer<typeof capabilityCoverageV1Schema>;

export const capabilityUnknownAbilitySummarySchema = z.object({
  spellId: z.number().int(),
  rawName: z.string().nullable(),
  eventTypes: z.array(z.string()),
  actorOwnership: z.array(z.enum(["PLAYER", "OWNED_PET_OR_GUARDIAN", "OTHER"])),
  count: z.number().int().positive(),
  firstTimestampMs: z.number().nullable(),
  lastTimestampMs: z.number().nullable(),
  reasonExcluded: z.string().min(1),
});
export type CapabilityUnknownAbilitySummary = z.infer<
  typeof capabilityUnknownAbilitySummarySchema
>;

export const capabilityCompactEventSchema = z.object({
  eventId: z.string().min(1),
  timestampMs: z.number(),
  dataset: z.string().min(1),
  eventType: z.string().nullable(),
  spellId: z.number().int().nullable(),
  rawName: z.string().nullable(),
  sourceActorId: z.number().int().nullable(),
  sourceOwnerPlayerActorId: z.number().int().nullable(),
  targetActorId: z.number().int().nullable(),
  targetPlayerActorId: z.number().int().nullable(),
  amount: z.number().nullable().optional(),
  /** Victim/current HP when WCL includeResources was requested (DamageTaken/Deaths). */
  hitPoints: z.number().nonnegative().nullable().optional(),
  /** Victim max HP when WCL includeResources was requested (DamageTaken/Deaths). */
  maxHitPoints: z.number().positive().nullable().optional(),
  capabilities: z.array(evidenceCapabilitySchema).min(1),
});
export type CapabilityCompactEvent = z.infer<typeof capabilityCompactEventSchema>;

/**
 * Minimal CombatantInfo loadout projection for conditional cooldown availability.
 * Not a parallel talent system — spell/node IDs only.
 */
export const participantLoadoutEvidenceV1Schema = z.object({
  actorId: z.number().int().positive(),
  blizzardSpecId: z.number().int().nullable(),
  talentSpellIds: z.array(z.number().int()),
  talentTreeNodeIds: z.array(z.number().int()).default([]),
  evidenceState: z.enum(["PRESENT", "ABSENT", "UNPARSEABLE"]),
});
export type ParticipantLoadoutEvidenceV1 = z.infer<
  typeof participantLoadoutEvidenceV1Schema
>;

export const capabilityEvidenceCompatibilityIdentitySchema = z.object({
  reportCode: z.string().min(1),
  fightId: z.number().int().nonnegative(),
  reportRevision: z.number().int().nonnegative(),
  dataset: z.string().min(1),
  capabilitySet: z.array(evidenceCapabilitySchema).min(1),
  actorSetHash: z.string().min(8),
  abilityFilterHash: z.string().min(8),
  catalogVersion: z.string().min(1),
  packageSchemaVersion: z.literal(CAPABILITY_EVIDENCE_PACKAGE_SCHEMA_VERSION),
  acquisitionPlanVersion: z.literal(CAPABILITY_ACQUISITION_PLAN_VERSION),
  graphqlQueryVersion: z.literal(WCL_GRAPHQL_QUERY_VERSION),
  mode: z.enum(ACQUISITION_MODES),
});
export type CapabilityEvidenceCompatibilityIdentity = z.infer<
  typeof capabilityEvidenceCompatibilityIdentitySchema
>;

export const capabilityEvidencePackageV1Schema = z
  .object({
    schemaVersion: z.literal(CAPABILITY_EVIDENCE_PACKAGE_SCHEMA_VERSION),
    mode: z.enum(ACQUISITION_MODES),
    sourceKey: z.object({
      reportCode: z.string().min(1),
      fightId: z.number().int().nonnegative(),
      reportRevision: z.number().int().nonnegative(),
    }),
    compatibilityIdentity: capabilityEvidenceCompatibilityIdentitySchema,
    compatibilityKey: z.string().min(1),
    acquisitionPlanVersion: z.literal(CAPABILITY_ACQUISITION_PLAN_VERSION),
    catalogVersion: z.string().min(1),
    graphqlQueryVersion: z.literal(WCL_GRAPHQL_QUERY_VERSION),
    friendlyPlayerActorIds: z.array(z.number().int().positive()).min(1).max(5),
    ownedPetActorIds: z.array(z.number().int()),
    actorSetHash: z.string().min(8),
    abilityFilterHash: z.string().min(8),
    capabilitySet: z.array(evidenceCapabilitySchema).min(1),
    coverage: z.array(capabilityCoverageV1Schema),
    compactEvents: z.array(capabilityCompactEventSchema),
    /** Actor-scoped CombatantInfo loadout proof (empty when absent). */
    participantLoadouts: z.array(participantLoadoutEvidenceV1Schema).default([]),
    unknownAbilitySummaries: z.array(capabilityUnknownAbilitySummarySchema),
    retention: z.object({
      rawPages: z.literal("EPHEMERAL_RAW_PAGE"),
      packageClass: z.literal("CANONICAL_CAPABILITY_EVIDENCE"),
      diagnosticClass: z.literal("PINNED_DIAGNOSTIC"),
    }),
    accounting: z.object({
      graphqlRequestCount: z.number().int().nonnegative(),
      pagesFetched: z.number().int().nonnegative(),
      eventsBeforeRelevanceFilter: z.number().int().nonnegative(),
      eventsAfterRelevanceFilter: z.number().int().nonnegative(),
      filterBatchCount: z.number().int().nonnegative(),
      providerCalls: z.number().int().nonnegative(),
    }),
    verifiedFilters: z.array(
      z.object({
        dataset: z.string().min(1),
        filterExpression: z.string().nullable(),
        sourceID: z.number().int().nullable(),
        hostilityType: z.string().nullable(),
        includeResources: z.boolean(),
        batchIndex: z.number().int().nonnegative(),
        batchCount: z.number().int().positive(),
      }),
    ),
    sourceArtifactIds: z.array(z.string()),
    complete: z.boolean(),
    limitations: z.array(z.string()),
    contentHash: z.string().min(16),
  })
  .strict();
export type CapabilityEvidencePackageV1 = z.infer<
  typeof capabilityEvidencePackageV1Schema
>;

function assertNoForbiddenScoreKeys(value: unknown, path = "$"): void {
  if (value == null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoForbiddenScoreKeys(item, `${path}[${i}]`));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if ((WCL_DIGEST_FORBIDDEN_SCORE_KEYS as readonly string[]).includes(key)) {
      throw new Error(`capability_evidence_contains_forbidden_field:${key}`);
    }
    assertNoForbiddenScoreKeys(child, `${path}.${key}`);
  }
}

export function assertCapabilityEvidencePackageV1(
  value: unknown,
): CapabilityEvidencePackageV1 {
  assertNoForbiddenScoreKeys(value);
  return capabilityEvidencePackageV1Schema.parse(value);
}

export function hashSortedInts(values: readonly number[]): string {
  const sorted = [...new Set(values.filter((n) => Number.isFinite(n)))].sort(
    (a, b) => a - b,
  );
  return sha256Hex(sorted.join(",")).slice(0, 16);
}

export function hashCapabilitySet(capabilities: readonly EvidenceCapability[]): string {
  return sha256Hex([...capabilities].sort().join(",")).slice(0, 16);
}

export function buildCapabilityEvidenceCompatibilityIdentity(input: {
  reportCode: string;
  fightId: number;
  reportRevision: number;
  dataset: string;
  capabilitySet: readonly EvidenceCapability[];
  actorSetHash: string;
  abilityFilterHash: string;
  catalogVersion: string;
  mode: AcquisitionMode;
}): CapabilityEvidenceCompatibilityIdentity {
  return {
    reportCode: input.reportCode,
    fightId: input.fightId,
    reportRevision: input.reportRevision,
    dataset: input.dataset,
    capabilitySet: [...input.capabilitySet].sort() as EvidenceCapability[],
    actorSetHash: input.actorSetHash,
    abilityFilterHash: input.abilityFilterHash,
    catalogVersion: input.catalogVersion,
    packageSchemaVersion: CAPABILITY_EVIDENCE_PACKAGE_SCHEMA_VERSION,
    acquisitionPlanVersion: CAPABILITY_ACQUISITION_PLAN_VERSION,
    graphqlQueryVersion: WCL_GRAPHQL_QUERY_VERSION,
    mode: input.mode,
  };
}

/**
 * Durable compatibility key. Filtered and unfiltered streams must never collide:
 * abilityFilterHash differs (`none` vs content hash).
 */
export function capabilityEvidenceCompatibilityKeyString(
  identity: CapabilityEvidenceCompatibilityIdentity,
): string {
  return [
    "wcl-capability-evidence",
    identity.reportCode,
    `r${identity.reportRevision}`,
    `f${identity.fightId}`,
    identity.dataset,
    `caps:${hashCapabilitySet(identity.capabilitySet)}`,
    `actors:${identity.actorSetHash}`,
    `abilities:${identity.abilityFilterHash}`,
    `catalog:${identity.catalogVersion}`,
    identity.packageSchemaVersion,
    identity.acquisitionPlanVersion,
    identity.graphqlQueryVersion,
    identity.mode,
  ].join("|");
}

/** Package-level identity (dataset = PACKAGE). */
export function buildCapabilityPackageCompatibilityKey(input: {
  reportCode: string;
  fightId: number;
  reportRevision: number;
  capabilitySet: readonly EvidenceCapability[];
  actorSetHash: string;
  abilityFilterHash: string;
  catalogVersion: string;
  mode: AcquisitionMode;
}): string {
  return capabilityEvidenceCompatibilityKeyString(
    buildCapabilityEvidenceCompatibilityIdentity({
      ...input,
      dataset: "PACKAGE",
    }),
  );
}

export function hashCapabilityEvidencePayload(value: unknown): string {
  const clone = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  delete clone.contentHash;
  return sha256Hex(JSON.stringify(clone));
}

/**
 * Completeness is capability-scoped: incomplete A must not force incomplete B.
 * A coverage row is incomplete when a continuation exists, max pages hit,
 * cursor stalled, a batch failed/missing, or fight bounds were not respected.
 */
export function isCapabilityCoverageComplete(coverage: CapabilityCoverageV1): boolean {
  if (!coverage.complete) return false;
  if (coverage.nextPageTimestamp != null) return false;
  if (coverage.stopReason === "MAX_PAGES") return false;
  if (coverage.stopReason === "NON_PROGRESSING_CURSOR") return false;
  if (coverage.stopReason === "FILTER_BATCH_FAILED") return false;
  if (coverage.stopReason === "MISSING_REQUIRED_BATCH") return false;
  if (coverage.stopReason === "FIGHT_BOUNDS_NOT_RESPECTED") return false;
  if (coverage.stopReason === "GRAPHQL_ERROR") return false;
  return true;
}

export function packageCompleteFromCoverage(
  coverage: readonly CapabilityCoverageV1[],
): boolean {
  return coverage.length > 0 && coverage.every(isCapabilityCoverageComplete);
}
