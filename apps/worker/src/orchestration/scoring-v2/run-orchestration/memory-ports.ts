/**
 * In-memory ports for provider-free orchestration tests.
 */
import { createHash, randomUUID } from "node:crypto";
import {
  CAPABILITY_ACQUISITION_PLAN_VERSION,
  CAPABILITY_EVIDENCE_PACKAGE_SCHEMA_VERSION,
  WCL_GRAPHQL_QUERY_VERSION,
  buildCapabilityPackageCompatibilityKey,
  buildParticipantDigestCompatibilityKey,
  hashCapabilityEvidencePayload,
  type CapabilityEvidencePackageV1,
  type EvidenceCapability,
  type ParticipantScoringDigestV1,
} from "@mplus/contracts";
import {
  createInMemorySourceFightLock,
  sourceFightKey,
  type AcquireCapabilityPackageResult,
  type CompatiblePackageHit,
  type OrchestrationParticipant,
  type PersistedDigestRecord,
  type RunOrchestrationPorts,
  type SourceFightIdentity,
} from "./orchestrator.js";

const DEFAULT_CAPABILITIES: EvidenceCapability[] = [
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
  "PARTICIPANT_METADATA",
  "ACTOR_OWNERSHIP",
];

function coverageRow(capability: EvidenceCapability, datasets: string[]) {
  return {
    capability,
    requiredDatasets: datasets,
    filterIdentity: "test",
    pageCount: 1,
    eventCount: 1,
    firstTimestampMs: 0,
    lastTimestampMs: 1000,
    nextPageTimestamp: null,
    stopReason: "NEXT_PAGE_NULL" as const,
    complete: true,
    limitations: [] as string[],
    sourceArtifactIds: [] as string[],
  };
}

export function buildMinimalCapabilityPackage(input: {
  sourceFight: SourceFightIdentity;
  participants: OrchestrationParticipant[];
  catalogVersion?: string;
}): CapabilityEvidencePackageV1 {
  const catalogVersion = input.catalogVersion ?? "catalog-test-v1";
  const actorIds = input.participants.map((p) => p.playerActorId);
  const actorSetHash = createHash("sha256")
    .update(actorIds.slice().sort((a, b) => a - b).join(","))
    .digest("hex")
    .slice(0, 16);
  const abilityFilterHash = "none";
  const compatibilityKey = buildCapabilityPackageCompatibilityKey({
    reportCode: input.sourceFight.reportCode,
    fightId: input.sourceFight.fightId,
    reportRevision: input.sourceFight.reportRevision,
    capabilitySet: DEFAULT_CAPABILITIES,
    actorSetHash,
    abilityFilterHash,
    catalogVersion,
    mode: "PRODUCTION_CAPABILITY_ACQUISITION",
  });

  const withoutHash = {
    schemaVersion: CAPABILITY_EVIDENCE_PACKAGE_SCHEMA_VERSION,
    mode: "PRODUCTION_CAPABILITY_ACQUISITION" as const,
    sourceKey: { ...input.sourceFight },
    compatibilityIdentity: {
      reportCode: input.sourceFight.reportCode,
      fightId: input.sourceFight.fightId,
      reportRevision: input.sourceFight.reportRevision,
      dataset: "PACKAGE",
      capabilitySet: [...DEFAULT_CAPABILITIES].sort() as EvidenceCapability[],
      actorSetHash,
      abilityFilterHash,
      catalogVersion,
      acquisitionPlanVersion: CAPABILITY_ACQUISITION_PLAN_VERSION,
      graphqlQueryVersion: WCL_GRAPHQL_QUERY_VERSION,
      mode: "PRODUCTION_CAPABILITY_ACQUISITION" as const,
    },
    compatibilityKey,
    acquisitionPlanVersion: CAPABILITY_ACQUISITION_PLAN_VERSION,
    catalogVersion,
    graphqlQueryVersion: WCL_GRAPHQL_QUERY_VERSION,
    friendlyPlayerActorIds: actorIds,
    ownedPetActorIds: [] as number[],
    actorSetHash,
    abilityFilterHash,
    capabilitySet: [...DEFAULT_CAPABILITIES].sort() as EvidenceCapability[],
    coverage: [
      coverageRow("PERFORMANCE_OFFENSIVE_ACTIVATIONS", ["Casts", "Buffs"]),
      coverageRow("SURVIVAL_DEFENSIVE_ACTIVATIONS", ["Casts", "Buffs"]),
      coverageRow("SURVIVAL_RECOVERY_ACTIVATIONS", ["Casts", "Buffs"]),
      coverageRow("SURVIVAL_DAMAGE_TAKEN", ["DamageTaken"]),
      coverageRow("SURVIVAL_DEATHS", ["Deaths"]),
      coverageRow("UTILITY_INTERRUPTS", ["Interrupts"]),
      coverageRow("UTILITY_DISPELS", ["Dispels"]),
      coverageRow("UTILITY_CROWD_CONTROL", ["Casts", "Debuffs"]),
      coverageRow("UTILITY_EXTERNAL_CASTS", ["Casts", "Buffs"]),
      coverageRow("UTILITY_EXTERNAL_TARGET_CONTEXT", ["Buffs"]),
      coverageRow("PARTICIPANT_METADATA", ["masterData", "CombatantInfo"]),
      coverageRow("ACTOR_OWNERSHIP", ["masterData"]),
    ],
    compactEvents: [] as CapabilityEvidencePackageV1["compactEvents"],
    unknownAbilitySummaries: [],
    retention: {
      rawPages: "EPHEMERAL_RAW_PAGE" as const,
      packageClass: "CANONICAL_CAPABILITY_EVIDENCE" as const,
      diagnosticClass: "PINNED_DIAGNOSTIC" as const,
    },
    accounting: {
      graphqlRequestCount: 1,
      pagesFetched: 1,
      eventsBeforeRelevanceFilter: 0,
      eventsAfterRelevanceFilter: 0,
      filterBatchCount: 1,
      providerCalls: 1,
    },
    verifiedFilters: [],
    sourceArtifactIds: [],
    complete: true,
    limitations: [],
  };
  const contentHash = hashCapabilityEvidencePayload(withoutHash);
  return { ...withoutHash, contentHash };
}

export interface MemoryOrchestrationPorts extends RunOrchestrationPorts {
  /** Mutable accounting for assertions. */
  stats: {
    acquireCalls: number;
    providerCalls: number;
    packagesCreated: number;
    digestsCreated: number;
  };
  seedPackage(hit: CompatiblePackageHit): void;
  seedDigest(record: PersistedDigestRecord): void;
  setParticipants(
    sourceFight: SourceFightIdentity,
    participants: OrchestrationParticipant[],
  ): void;
  getPackageCount(): number;
  getDigestCount(): number;
  /** Force extractorCompatVersion used when rebuilding digests. */
  digestCatalogVersion: string;
}

export function createMemoryOrchestrationPorts(options?: {
  providerCallsPerAcquire?: number;
}): MemoryOrchestrationPorts {
  const packages = new Map<string, CompatiblePackageHit>();
  const digests = new Map<string, PersistedDigestRecord>();
  const participantsByFight = new Map<string, OrchestrationParticipant[]>();
  const lock = createInMemorySourceFightLock();
  const providerCallsPerAcquire = options?.providerCallsPerAcquire ?? 1;

  const stats = {
    acquireCalls: 0,
    providerCalls: 0,
    packagesCreated: 0,
    digestsCreated: 0,
  };

  const ports: MemoryOrchestrationPorts = {
    stats,
    digestCatalogVersion: "catalog-test-v1",
    seedPackage(hit) {
      packages.set(sourceFightKey(hit.package.sourceKey), hit);
    },
    seedDigest(record) {
      const key = buildParticipantDigestCompatibilityKey({
        reportCode: record.digest.reportCode,
        fightId: record.digest.fightId,
        reportRevision: record.digest.reportRevision,
        participantActorId: record.digest.participantActorId,
        digestSchemaVersion: record.digest.schemaVersion,
        extractorCompatVersion: record.digest.extractorCompatVersion,
        capabilityPackageContentHash: record.digest.capabilityPackageContentHash,
        catalogVersion: record.digest.catalogVersion,
      });
      digests.set(key, record);
    },
    setParticipants(sourceFight, participants) {
      participantsByFight.set(sourceFightKey(sourceFight), participants);
    },
    getPackageCount: () => packages.size,
    getDigestCount: () => digests.size,

    withSourceFightLock: lock,

    async resolveParticipantsForFight({ sourceFight }) {
      const existing = participantsByFight.get(sourceFightKey(sourceFight));
      if (existing) return existing;
      const defaults: OrchestrationParticipant[] = [1, 2, 3, 4, 5].map((id) => ({
        playerActorId: id,
        characterName: id === 1 ? "Target" : `Player${id}`,
        realmSlug: "test",
        regionCode: "eu",
        classSlug: "mage",
        specSlug: "fire",
        role: "DPS",
        ownedPetActorIds: [],
        characterId: id === 1 ? "11111111-1111-4111-8111-111111111111" : null,
      }));
      participantsByFight.set(sourceFightKey(sourceFight), defaults);
      return defaults;
    },

    async findCompatibleCapabilityPackage({ sourceFight }) {
      return packages.get(sourceFightKey(sourceFight)) ?? null;
    },

    async acquireAndPersistCapabilityPackage({ sourceFight, participants }) {
      stats.acquireCalls += 1;
      const existing = packages.get(sourceFightKey(sourceFight));
      if (existing) {
        return {
          package: existing.package,
          packageArtifactId: existing.packageArtifactId,
          contentHash: existing.contentHash,
          providerCalls: 0,
          created: false,
        } satisfies AcquireCapabilityPackageResult;
      }

      stats.providerCalls += providerCallsPerAcquire;
      stats.packagesCreated += 1;
      const pkg = buildMinimalCapabilityPackage({
        sourceFight,
        participants,
        catalogVersion: ports.digestCatalogVersion,
      });
      const artifactId = randomUUID();
      const hit: CompatiblePackageHit = {
        package: pkg,
        packageArtifactId: artifactId,
        contentHash: pkg.contentHash,
        providerCalls: 0,
      };
      packages.set(sourceFightKey(sourceFight), hit);
      return {
        package: pkg,
        packageArtifactId: artifactId,
        contentHash: pkg.contentHash,
        providerCalls: providerCallsPerAcquire,
        created: true,
      };
    },

    async findCompatibleDigest(input) {
      const key = buildParticipantDigestCompatibilityKey(input);
      return digests.get(key) ?? null;
    },

    async persistDigest(digest: ParticipantScoringDigestV1) {
      const key = buildParticipantDigestCompatibilityKey({
        reportCode: digest.reportCode,
        fightId: digest.fightId,
        reportRevision: digest.reportRevision,
        participantActorId: digest.participantActorId,
        digestSchemaVersion: digest.schemaVersion,
        extractorCompatVersion: digest.extractorCompatVersion,
        capabilityPackageContentHash: digest.capabilityPackageContentHash,
        catalogVersion: digest.catalogVersion,
      });
      const existing = digests.get(key);
      if (existing && existing.digest.contentHash === digest.contentHash) {
        return existing;
      }
      stats.digestsCreated += 1;
      const record: PersistedDigestRecord = {
        digest,
        artifactId: randomUUID(),
        created: !existing,
      };
      digests.set(key, record);
      return record;
    },

    async resolveFightBounds() {
      return { fightStartMs: 0, fightEndMs: 1_800_000 };
    },
  };

  return ports;
}
