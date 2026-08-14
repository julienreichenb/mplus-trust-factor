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
  isCapabilityPackageAcceptableForScoring,
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
import {
  inferFightBoundsFromCompactEvents,
  type RankingParseFactInput,
} from "@mplus/provider-warcraftlogs";

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
  "UTILITY_HOSTILE_CASTS",
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
  /** When set, mark these capabilities incomplete while keeping others complete. */
  incompleteCapabilities?: readonly EvidenceCapability[];
}): CapabilityEvidencePackageV1 {
  const catalogVersion = input.catalogVersion ?? "catalog-test-v1";
  const incomplete = new Set(input.incompleteCapabilities ?? []);
  const actorIds = input.participants.map((p) => p.playerActorId);
  const actorSetHash = createHash("sha256")
    .update(actorIds.slice().sort((a, b) => a - b).join(","))
    .digest("hex")
    .slice(0, 16);
  const abilityFilterHash = "filter:none";
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

  const row = (capability: EvidenceCapability, datasets: string[]) => {
    const base = coverageRow(capability, datasets);
    if (!incomplete.has(capability)) return base;
    return {
      ...base,
      complete: false,
      stopReason: "MISSING_REQUIRED_BATCH" as const,
      eventCount: 0,
      limitations: [`DATASET_MISSING:${datasets[0] ?? "unknown"}`],
    };
  };

  const coverage = [
    row("PERFORMANCE_OFFENSIVE_ACTIVATIONS", ["Casts", "Buffs"]),
    row("SURVIVAL_DEFENSIVE_ACTIVATIONS", ["Casts", "Buffs"]),
    row("SURVIVAL_RECOVERY_ACTIVATIONS", ["Casts", "Buffs"]),
    row("SURVIVAL_DAMAGE_TAKEN", ["DamageTaken"]),
    row("SURVIVAL_DEATHS", ["Deaths"]),
    row("UTILITY_INTERRUPTS", ["Interrupts"]),
    row("UTILITY_DISPELS", ["Dispels"]),
    row("UTILITY_CROWD_CONTROL", ["Casts", "Debuffs"]),
    row("UTILITY_EXTERNAL_CASTS", ["Casts", "Buffs"]),
    row("UTILITY_EXTERNAL_TARGET_CONTEXT", ["Buffs"]),
    row("UTILITY_HOSTILE_CASTS", ["HostileCasts"]),
    row("PARTICIPANT_METADATA", ["masterData", "CombatantInfo"]),
    row("ACTOR_OWNERSHIP", ["masterData"]),
  ];
  const complete = incomplete.size === 0;

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
      packageSchemaVersion: CAPABILITY_EVIDENCE_PACKAGE_SCHEMA_VERSION,
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
    coverage,
    compactEvents: [] as CapabilityEvidencePackageV1["compactEvents"],
    participantLoadouts: [],
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
    complete,
    limitations: complete
      ? []
      : [...incomplete].map((c) => `CAPABILITY_INCOMPLETE:${c}`),
  };
  const contentHash = hashCapabilityEvidencePayload(withoutHash);
  return { ...withoutHash, contentHash };
}

export interface MemoryOrchestrationPorts extends RunOrchestrationPorts {
  /**
   * When set, newly acquired packages mark these capabilities incomplete
   * (Survival-only failure isolation tests).
   */
  acquireIncompleteCapabilities?: EvidenceCapability[];
  /** Mutable accounting for assertions. */
  stats: {
    acquireCalls: number;
    providerCalls: number;
    packagesCreated: number;
    digestsCreated: number;
  };
  seedPackage(hit: CompatiblePackageHit): void;
  seedDigest(record: PersistedDigestRecord): void;
  seedRanking(
    sourceFight: SourceFightIdentity,
    participantActorId: number,
    fact: RankingParseFactInput,
  ): void;
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
  /** When true (default), seed a usable ranking fact on acquire/seedPackage. */
  autoSeedRanking?: boolean;
}): MemoryOrchestrationPorts {
  const packages = new Map<string, CompatiblePackageHit>();
  const digests = new Map<string, PersistedDigestRecord>();
  const participantsByFight = new Map<string, OrchestrationParticipant[]>();
  const rankings = new Map<string, RankingParseFactInput>();
  const lock = createInMemorySourceFightLock();
  const providerCallsPerAcquire = options?.providerCallsPerAcquire ?? 1;
  const autoSeedRanking = options?.autoSeedRanking !== false;

  const defaultRanking = (): RankingParseFactInput => ({
    parsePercentile: 80,
    parseSemantic: "BRACKET_PERCENT",
    partition: 1,
    rawDps: 100_000,
    rankingProvenance: {
      providerContractVersion: "wcl-ranking-parse-v1",
      schemaVersion: "1.0.0",
      artifactId: "ranking-artifact-test",
      contentHash: "r".repeat(64),
      source: "PERSISTED_RANKING_PARSE",
    },
  });

  const maybeSeedRankings = (
    sourceFight: SourceFightIdentity,
    participants: OrchestrationParticipant[],
  ) => {
    if (!autoSeedRanking) return;
    for (const p of participants) {
      const key = `${sourceFightKey(sourceFight)}:${p.playerActorId}`;
      if (!rankings.has(key)) rankings.set(key, defaultRanking());
    }
  };

  const stats = {
    acquireCalls: 0,
    providerCalls: 0,
    packagesCreated: 0,
    digestsCreated: 0,
  };

  const ports: MemoryOrchestrationPorts = {
    stats,
    digestCatalogVersion: "catalog-test-v1",
    acquireIncompleteCapabilities: undefined,
    seedPackage(hit) {
      packages.set(sourceFightKey(hit.package.sourceKey), hit);
      const sourceFight = {
        reportCode: hit.package.sourceKey.reportCode,
        fightId: hit.package.sourceKey.fightId,
        reportRevision: hit.package.sourceKey.reportRevision,
      };
      const actors = hit.package.friendlyPlayerActorIds.map((id) => ({
        playerActorId: id,
        characterName: id === 1 ? "Target" : `Player${id}`,
        realmSlug: "test",
        regionCode: "eu",
        classSlug: "mage",
        specSlug: "fire",
        role: "DPS",
        ownedPetActorIds: [] as number[],
        characterId: id === 1 ? "11111111-1111-4111-8111-111111111111" : null,
      }));
      maybeSeedRankings(sourceFight, actors);
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
    seedRanking(sourceFight, participantActorId, fact) {
      rankings.set(`${sourceFightKey(sourceFight)}:${participantActorId}`, fact);
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
      const hit = packages.get(sourceFightKey(sourceFight)) ?? null;
      if (
        hit &&
        !isCapabilityPackageAcceptableForScoring({
          complete: hit.package.complete,
          coverage: hit.package.coverage,
        })
      ) {
        return null;
      }
      return hit;
    },

    async acquireAndPersistCapabilityPackage({ sourceFight, participants }) {
      stats.acquireCalls += 1;
      const existing = packages.get(sourceFightKey(sourceFight));
      if (
        existing &&
        isCapabilityPackageAcceptableForScoring({
          complete: existing.package.complete,
          coverage: existing.package.coverage,
        })
      ) {
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
        incompleteCapabilities: ports.acquireIncompleteCapabilities,
      });
      const artifactId = randomUUID();
      const hit: CompatiblePackageHit = {
        package: pkg,
        packageArtifactId: artifactId,
        contentHash: pkg.contentHash,
        providerCalls: 0,
      };
      packages.set(sourceFightKey(sourceFight), hit);
      maybeSeedRankings(sourceFight, participants);
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

    async resolveFightBounds({ sourceFight }) {
      const hit = packages.get(sourceFightKey(sourceFight));
      if (hit) {
        return inferFightBoundsFromCompactEvents(hit.package.compactEvents);
      }
      return { fightStartMs: 0, fightEndMs: 1_800_000 };
    },

    async resolveRankingParseForParticipant({ sourceFight, participantActorId }) {
      return (
        rankings.get(`${sourceFightKey(sourceFight)}:${participantActorId}`) ?? null
      );
    },
  };

  return ports;
}
