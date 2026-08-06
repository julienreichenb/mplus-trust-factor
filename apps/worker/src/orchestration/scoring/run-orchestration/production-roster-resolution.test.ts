/**
 * Production roster wiring — Tests B, C, D, F, H.
 * Exercises createProductionRunOrchestrationPorts + ensurePackageAndDigests.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  buildWclRunRawPayloadV1,
  CAPABILITY_ACQUISITION_PLAN_VERSION,
  CAPABILITY_EVIDENCE_PACKAGE_SCHEMA_VERSION,
  WCL_GRAPHQL_QUERY_VERSION,
  buildCapabilityPackageCompatibilityKey,
  hashCapabilityEvidencePayload,
  type CapabilityEvidencePackageV1,
  type EvidenceCapability,
  type EvidenceCandidateMetadataV2,
  type EvidenceSelectionScope,
  EVIDENCE_SELECTOR_VERSION,
} from "@mplus/contracts";
import {
  createProductionRunOrchestrationPorts,
  SCORING_ACQUISITION_VERSION,
} from "./production-ports.js";
import {
  orchestrateScoringRuns,
  sourceFightKey,
  type SourceFightIdentity,
} from "./orchestrator.js";

const TARGET_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const CHAR_NAME = "Wallidrixe";
const REALM = "archimonde";
const REGION = "EU";

const MASTER_DATA = {
  actors: [
    { id: 1, name: "Wallidrixe", type: "Player", server: "Archimonde", subType: "Warlock" },
    { id: 2, name: "HealerOne", type: "Player", server: "Archimonde", subType: "Priest" },
    { id: 3, name: "TankOne", type: "Player", server: "Archimonde", subType: "Paladin" },
    { id: 4, name: "DpsTwo", type: "Player", server: "Illidan", subType: "Hunter" },
    { id: 5, name: "DpsThree", type: "Player", server: "Archimonde", subType: "Mage" },
    { id: 50, name: "Imp", type: "Pet", petOwner: 1 },
    { id: 99, name: "Boss", type: "NPC" },
  ],
};

const CAPABILITIES: EvidenceCapability[] = [
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

function buildPkg(fight: SourceFightIdentity): CapabilityEvidencePackageV1 {
  const actorSetHash = "actors0123456789";
  const abilityFilterHash = "abilities0123456";
  const catalogVersion = "catalog-test-v1";
  const compatibilityKey = buildCapabilityPackageCompatibilityKey({
    ...fight,
    capabilitySet: CAPABILITIES,
    actorSetHash,
    abilityFilterHash,
    catalogVersion,
    mode: "PRODUCTION_CAPABILITY_ACQUISITION",
  });
  const withoutHash = {
    schemaVersion: CAPABILITY_EVIDENCE_PACKAGE_SCHEMA_VERSION,
    mode: "PRODUCTION_CAPABILITY_ACQUISITION" as const,
    sourceKey: { ...fight },
    compatibilityIdentity: {
      ...fight,
      dataset: "PACKAGE",
      capabilitySet: [...CAPABILITIES].sort() as EvidenceCapability[],
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
    friendlyPlayerActorIds: [1, 2, 3, 4, 5],
    ownedPetActorIds: [50],
    actorSetHash,
    abilityFilterHash,
    capabilitySet: [...CAPABILITIES].sort() as EvidenceCapability[],
    coverage: CAPABILITIES.map((capability) => ({
      capability,
      requiredDatasets: ["Buffs"],
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
    })),
    compactEvents: [],
    unknownAbilitySummaries: [],
    retention: {
      rawPages: "EPHEMERAL_RAW_PAGE" as const,
      packageClass: "CANONICAL_CAPABILITY_EVIDENCE" as const,
      diagnosticClass: "PINNED_DIAGNOSTIC" as const,
    },
    accounting: {
      graphqlRequestCount: 0,
      pagesFetched: 0,
      eventsBeforeRelevanceFilter: 0,
      eventsAfterRelevanceFilter: 0,
      filterBatchCount: 0,
      providerCalls: 0,
    },
    verifiedFilters: [],
    sourceArtifactIds: [],
    complete: true,
    limitations: [] as string[],
  };
  return {
    ...withoutHash,
    contentHash: hashCapabilityEvidencePayload(withoutHash),
  };
}

function createInMemoryScoringPrisma() {
  type RawRow = {
    id: string;
    reportCode: string;
    fightId: number;
    reportRevision: number;
    acquisitionVersion: string;
    payload: unknown;
    fetchedAt: Date;
    providerCost: unknown;
  };
  type DigestRow = {
    id: string;
    rawRunId: string;
    participantActorId: number;
    extractorVersion: string;
    characterId: string | null;
    characterName: string;
    realmSlug: string | null;
    regionCode: string | null;
    classSlug: string | null;
    specSlug: string | null;
    role: string | null;
    offensive: unknown;
    utility: unknown;
    survival: unknown;
    sourceMetadata: unknown;
  };

  const rawByKey = new Map<string, RawRow>();
  const digestsByKey = new Map<string, DigestRow>();
  let characterCreateCalls = 0;

  const rawKey = (i: {
    reportCode: string;
    fightId: number;
    reportRevision: number;
    acquisitionVersion: string;
  }) =>
    `${i.reportCode}:${i.fightId}:${i.reportRevision}:${i.acquisitionVersion}`;

  const digestKey = (i: {
    rawRunId: string;
    participantActorId: number;
    extractorVersion: string;
  }) => `${i.rawRunId}:${i.participantActorId}:${i.extractorVersion}`;

  const prisma = {
    wclRunRaw: {
      findUnique: async ({
        where,
      }: {
        where: {
          reportCode_fightId_reportRevision_acquisitionVersion: {
            reportCode: string;
            fightId: number;
            reportRevision: number;
            acquisitionVersion: string;
          };
        };
      }) => {
        const id = where.reportCode_fightId_reportRevision_acquisitionVersion;
        return rawByKey.get(rawKey(id)) ?? null;
      },
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: {
          reportCode_fightId_reportRevision_acquisitionVersion: {
            reportCode: string;
            fightId: number;
            reportRevision: number;
            acquisitionVersion: string;
          };
        };
        create: Omit<RawRow, "id"> & { id?: string };
        update: Partial<RawRow>;
      }) => {
        const key = rawKey(where.reportCode_fightId_reportRevision_acquisitionVersion);
        const existing = rawByKey.get(key);
        if (!existing) {
          const row: RawRow = {
            id: create.id ?? randomUUID(),
            reportCode: create.reportCode,
            fightId: create.fightId,
            reportRevision: create.reportRevision,
            acquisitionVersion: create.acquisitionVersion,
            payload: create.payload,
            fetchedAt: create.fetchedAt ?? new Date(),
            providerCost: create.providerCost ?? null,
          };
          rawByKey.set(key, row);
          return row;
        }
        const row = {
          ...existing,
          payload: update.payload ?? existing.payload,
          fetchedAt: update.fetchedAt ?? existing.fetchedAt,
          providerCost: update.providerCost ?? existing.providerCost,
        };
        rawByKey.set(key, row);
        return row;
      },
    },
    characterRunDigest: {
      findUnique: async ({
        where,
      }: {
        where: {
          rawRunId_participantActorId_extractorVersion: {
            rawRunId: string;
            participantActorId: number;
            extractorVersion: string;
          };
        };
      }) => {
        const id = where.rawRunId_participantActorId_extractorVersion;
        return digestsByKey.get(digestKey(id)) ?? null;
      },
      create: async ({ data }: { data: Omit<DigestRow, "id"> & { id?: string } }) => {
        const row: DigestRow = { id: data.id ?? randomUUID(), ...data };
        digestsByKey.set(
          digestKey({
            rawRunId: row.rawRunId,
            participantActorId: row.participantActorId,
            extractorVersion: row.extractorVersion,
          }),
          row,
        );
        return row;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<DigestRow>;
      }) => {
        for (const [k, row] of digestsByKey) {
          if (row.id === where.id) {
            const next = { ...row, ...data };
            digestsByKey.set(k, next);
            return next;
          }
        }
        throw new Error("digest_not_found");
      },
    },
    character: {
      create: async () => {
        characterCreateCalls += 1;
        throw new Error("character_auto_create_forbidden_in_test");
      },
      findUnique: async () => null,
    },
    runRankingFact: {
      findMany: async () => [],
    },
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join("?");
      if (sql.includes("FROM character_run_digests") && sql.includes("raw_run_id")) {
        const rawRunId = values[0];
        const participantActorId = values[1];
        const extractorVersion = values[2];
        for (const row of digestsByKey.values()) {
          if (
            row.rawRunId === rawRunId &&
            row.participantActorId === participantActorId &&
            row.extractorVersion === extractorVersion
          ) {
            return [{ id: row.id, character_id: row.characterId }];
          }
        }
        return [];
      }
      return [];
    },
    $transaction: async <T>(fn: (tx: typeof prisma) => Promise<T>) => fn(prisma),
  };

  return {
    prisma: prisma as never,
    rawByKey,
    digestsByKey,
    get characterCreateCalls() {
      return characterCreateCalls;
    },
  };
}

function targetCharacter(overrides?: {
  characterName?: string;
  realmSlug?: string;
}) {
  return {
    characterId: TARGET_ID,
    characterName: overrides?.characterName ?? CHAR_NAME,
    realmSlug: overrides?.realmSlug ?? REALM,
    regionCode: REGION,
    classSlug: "warlock",
    specSlug: "demonology",
    role: "DPS",
  };
}

describe("production roster resolution wiring", () => {
  it("B: persists five durable digests through production ports", async () => {
    const db = createInMemoryScoringPrisma();
    const fight: SourceFightIdentity = {
      reportCode: "RoStEr01",
      fightId: 7,
      reportRevision: 1,
    };
    const pkg = buildPkg(fight);
    const envelope = buildWclRunRawPayloadV1({
      capabilityPackage: pkg,
      masterData: MASTER_DATA,
      regionCode: REGION,
    });

    let acquireCalls = 0;
    const ports = createProductionRunOrchestrationPorts({
      prisma: db.prisma,
      artifacts: { readVerified: async () => Buffer.from("{}") } as never,
      evidence: { findDatasetByCompatibilityKey: async () => null } as never,
      targetCharacter: targetCharacter(),
      liveAcquireCapabilityPackage: async (input) => {
        acquireCalls += 1;
        const acquiredPkg = buildPkg(input.sourceFight);
        return {
          package: acquiredPkg,
          packageArtifactId: randomUUID(),
          contentHash: acquiredPkg.contentHash,
          providerCalls: 1,
          created: true,
          masterData: MASTER_DATA,
          regionCode: REGION,
        };
      },
    });

    // Seed raw so warm resolve works after first acquire path too.
    await db.prisma.wclRunRaw.upsert({
      where: {
        reportCode_fightId_reportRevision_acquisitionVersion: {
          ...fight,
          acquisitionVersion: SCORING_ACQUISITION_VERSION,
        },
      },
      create: {
        ...fight,
        acquisitionVersion: SCORING_ACQUISITION_VERSION,
        payload: envelope,
        fetchedAt: new Date(),
        providerCost: null,
      },
      update: { payload: envelope },
    });

    const participants = await ports.resolveParticipantsForFight({
      sourceFight: fight,
    });
    expect(participants).toHaveLength(5);
    expect(participants.map((p) => p.playerActorId).sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5,
    ]);
    expect(participants.find((p) => p.playerActorId === 1)?.characterId).toBe(TARGET_ID);
    expect(participants.filter((p) => p.characterId != null)).toHaveLength(1);
    expect(participants.every((p) => !/^Actor\d+$/i.test(p.characterName))).toBe(true);

    // Build digests via acquire path on a second fight identity.
    const fight2: SourceFightIdentity = {
      reportCode: "RoStEr02",
      fightId: 8,
      reportRevision: 1,
    };
    const acquired = await ports.acquireAndPersistCapabilityPackage({
      sourceFight: fight2,
      dungeonSlug: "skyreach",
      keyLevel: 16,
      participants,
    });
    expect(acquired.created).toBe(true);
    expect(acquireCalls).toBe(1);

    const resolved = await ports.resolveParticipantsForFight({
      sourceFight: fight2,
    });
    expect(resolved).toHaveLength(5);

    const pkg2 = buildPkg(fight2);
    const built = (
      await import("@mplus/provider-warcraftlogs")
    ).buildParticipantScoringDigestsFromPackage({
      capabilityPackage: pkg2,
      packageArtifactId: acquired.packageArtifactId,
      participants: resolved,
      dungeonSlug: "skyreach",
      keyLevel: 16,
      timed: true,
      runScore: 400,
      completedAt: "2026-01-01T00:00:00.000Z",
      fightStartMs: 0,
      fightEndMs: 1000,
      catalogVersion: pkg2.catalogVersion,
    });
    expect(built).toHaveLength(5);

    const findSpy = vi.spyOn(ports, "findCompatibleDigest");
    const persisted = [];
    for (const digest of built) {
      const existing = await ports.findCompatibleDigest({
        reportCode: digest.reportCode,
        fightId: digest.fightId,
        reportRevision: digest.reportRevision,
        participantActorId: digest.participantActorId,
        digestSchemaVersion: digest.schemaVersion,
        extractorCompatVersion: digest.extractorCompatVersion,
        capabilityPackageContentHash: digest.capabilityPackageContentHash,
        catalogVersion: digest.catalogVersion,
      });
      expect(existing).toBeNull();
      persisted.push(await ports.persistDigest(digest));
    }
    expect(findSpy).toHaveBeenCalledTimes(5);
    expect(
      findSpy.mock.calls.map((c) => c[0].participantActorId).sort((a, b) => a - b),
    ).toEqual([1, 2, 3, 4, 5]);
    expect(persisted).toHaveLength(5);
    expect(persisted.every((p) => p.created)).toBe(true);
    expect(persisted.every((p) => typeof p.artifactId === "string")).toBe(true);
    expect(db.characterCreateCalls).toBe(0);
    expect(db.digestsByKey.size).toBe(5);
  });

  it("C: warm raw cache reuses roster without detailed acquisition", async () => {
    const db = createInMemoryScoringPrisma();
    const fight: SourceFightIdentity = {
      reportCode: "WarmRaw1",
      fightId: 1,
      reportRevision: 2,
    };
    const pkg = buildPkg(fight);
    let acquireCalls = 0;
    const ports = createProductionRunOrchestrationPorts({
      prisma: db.prisma,
      artifacts: { readVerified: async () => Buffer.from("{}") } as never,
      evidence: { findDatasetByCompatibilityKey: async () => null } as never,
      targetCharacter: targetCharacter(),
      liveAcquireCapabilityPackage: async () => {
        acquireCalls += 1;
        if (acquireCalls > 1) {
          throw new Error("warm_path_must_not_reacquire");
        }
        return {
          package: pkg,
          packageArtifactId: randomUUID(),
          contentHash: pkg.contentHash,
          providerCalls: 3,
          created: true,
          masterData: MASTER_DATA,
          regionCode: REGION,
        };
      },
    });

    await ports.acquireAndPersistCapabilityPackage({
      sourceFight: fight,
      dungeonSlug: "skyreach",
      keyLevel: 14,
      participants: [],
    });
    expect(acquireCalls).toBe(1);

    const first = await ports.resolveParticipantsForFight({ sourceFight: fight });
    const hit = await ports.findCompatibleCapabilityPackage({ sourceFight: fight });
    expect(hit).not.toBeNull();
    expect(hit!.providerCalls).toBe(0);

    const second = await ports.resolveParticipantsForFight({ sourceFight: fight });
    expect(second.map((p) => p.playerActorId)).toEqual(
      first.map((p) => p.playerActorId),
    );
    expect(acquireCalls).toBe(1);

    // Persist digests once, then warm again — no duplicates.
    const built = (
      await import("@mplus/provider-warcraftlogs")
    ).buildParticipantScoringDigestsFromPackage({
      capabilityPackage: pkg,
      packageArtifactId: hit!.packageArtifactId,
      participants: first,
      dungeonSlug: "skyreach",
      keyLevel: 14,
      timed: true,
      runScore: 300,
      completedAt: "2026-01-01T00:00:00.000Z",
      fightStartMs: 0,
      fightEndMs: 1000,
      catalogVersion: pkg.catalogVersion,
    });
    for (const d of built) {
      await ports.persistDigest(d);
    }
    expect(db.digestsByKey.size).toBe(5);
    for (const d of built) {
      const again = await ports.persistDigest(d);
      expect(again.created).toBe(false);
    }
    expect(db.digestsByKey.size).toBe(5);
  });

  it("bare legacy raw packages are not warm-compatible roster hits", async () => {
    const db = createInMemoryScoringPrisma();
    const fight: SourceFightIdentity = {
      reportCode: "BarePkg",
      fightId: 1,
      reportRevision: 1,
    };
    const pkg = buildPkg(fight);
    await db.prisma.wclRunRaw.upsert({
      where: {
        reportCode_fightId_reportRevision_acquisitionVersion: {
          ...fight,
          acquisitionVersion: SCORING_ACQUISITION_VERSION,
        },
      },
      create: {
        ...fight,
        acquisitionVersion: SCORING_ACQUISITION_VERSION,
        payload: pkg,
        fetchedAt: new Date(),
        providerCost: null,
      },
      update: { payload: pkg },
    });

    const liveAcquire = vi.fn(async () => {
      throw new Error("must_not_acquire_in_this_assertion");
    });
    const ports = createProductionRunOrchestrationPorts({
      prisma: db.prisma,
      artifacts: { readVerified: async () => Buffer.from("{}") } as never,
      evidence: { findDatasetByCompatibilityKey: async () => null } as never,
      targetCharacter: targetCharacter(),
      liveAcquireCapabilityPackage: liveAcquire,
    });

    const hit = await ports.findCompatibleCapabilityPackage({ sourceFight: fight });
    expect(hit).toBeNull();
    await expect(
      ports.resolveParticipantsForFight({ sourceFight: fight }),
    ).rejects.toMatchObject({ code: "RAW_PACKAGE_MISSING_FIGHT_ROSTER" });
    expect(liveAcquire).not.toHaveBeenCalled();
  });

  it("D: provider-free replay resolves roster with zero provider calls", async () => {
    const db = createInMemoryScoringPrisma();
    const fight: SourceFightIdentity = {
      reportCode: "Replay1",
      fightId: 3,
      reportRevision: 1,
    };
    const pkg = buildPkg(fight);
    const envelope = buildWclRunRawPayloadV1({
      capabilityPackage: pkg,
      masterData: MASTER_DATA,
      regionCode: REGION,
    });
    await db.prisma.wclRunRaw.upsert({
      where: {
        reportCode_fightId_reportRevision_acquisitionVersion: {
          ...fight,
          acquisitionVersion: SCORING_ACQUISITION_VERSION,
        },
      },
      create: {
        ...fight,
        acquisitionVersion: SCORING_ACQUISITION_VERSION,
        payload: envelope,
        fetchedAt: new Date(),
        providerCost: null,
      },
      update: { payload: envelope },
    });

    const liveAcquire = vi.fn(async () => {
      throw new Error("provider_must_not_be_called");
    });
    const ports = createProductionRunOrchestrationPorts({
      prisma: db.prisma,
      artifacts: { readVerified: async () => Buffer.from("{}") } as never,
      evidence: { findDatasetByCompatibilityKey: async () => null } as never,
      targetCharacter: targetCharacter(),
      liveAcquireCapabilityPackage: liveAcquire,
    });

    const participants = await ports.resolveParticipantsForFight({
      sourceFight: fight,
    });
    expect(participants).toHaveLength(5);
    expect(liveAcquire).not.toHaveBeenCalled();

    const scope: EvidenceSelectionScope = {
      characterId: TARGET_ID,
      seasonId: "season-1",
      seasonSlug: "s1",
      specializationId: null,
      classSlug: "warlock",
      specSlug: "demonology",
      role: "DPS",
      refreshContractHash: "replay-test",
      selectorVersion: EVIDENCE_SELECTOR_VERSION,
      evidenceCutoffAt: "2099-01-01T00:00:00.000Z",
      highKeyPolicyId: "p1",
      activeDungeonSlugs: ["skyreach"],
    };
    const candidates: EvidenceCandidateMetadataV2[] = [
      {
        discoveryIdentity: { reportCode: fight.reportCode, fightId: fight.fightId },
        reportRevision: fight.reportRevision,
        dungeonSlug: "skyreach",
        keyLevel: 16,
        timed: true,
        runScore: 400,
        evidenceCompleteness: 1,
        completedAt: "2026-01-01T00:00:00.000Z",
        fightDurationMs: 1_800_000,
        actorId: 1,
        accessState: "PUBLIC",
        identityResolution: "RESOLVED",
        fightAccessible: true,
        hardError: false,
      },
      {
        discoveryIdentity: { reportCode: "other", fightId: 9 },
        reportRevision: 1,
        dungeonSlug: "skyreach",
        keyLevel: 14,
        timed: true,
        runScore: 300,
        evidenceCompleteness: 1,
        completedAt: "2026-01-01T00:00:00.000Z",
        fightDurationMs: 1_800_000,
        actorId: 1,
        accessState: "PUBLIC",
        identityResolution: "RESOLVED",
        fightAccessible: true,
        hardError: false,
      },
    ];

    // Seed digests for the replay fight so target selection can succeed.
    const built = (
      await import("@mplus/provider-warcraftlogs")
    ).buildParticipantScoringDigestsFromPackage({
      capabilityPackage: pkg,
      packageArtifactId: (await ports.findCompatibleCapabilityPackage({ sourceFight: fight }))!
        .packageArtifactId,
      participants,
      dungeonSlug: "skyreach",
      keyLevel: 16,
      timed: true,
      runScore: 400,
      completedAt: "2026-01-01T00:00:00.000Z",
      fightStartMs: 0,
      fightEndMs: 1000,
      catalogVersion: pkg.catalogVersion,
    });
    for (const d of built) await ports.persistDigest(d);

    const result = await orchestrateScoringRuns({
      characterId: TARGET_ID,
      characterName: CHAR_NAME,
      region: REGION,
      realm: REALM,
      seasonId: "season-1",
      scoringModelId: "model-1",
      liveProviderPermission: "FORBIDDEN",
      scope,
      candidates,
      ports,
    });

    expect(liveAcquire).not.toHaveBeenCalled();
    expect(result.accounting.providerCalls).toBe(0);
    expect(result.characterDigests.some((d) => d.digest.characterId === TARGET_ID)).toBe(
      true,
    );
    expect(
      result.characterDigests.find((d) => d.digest.reportCode === fight.reportCode)?.digest
        .participantActorId,
    ).toBe(1);
  });

  it("F: missing target does not select another participant", async () => {
    const db = createInMemoryScoringPrisma();
    const fight: SourceFightIdentity = {
      reportCode: "MissTgt",
      fightId: 1,
      reportRevision: 1,
    };
    const pkg = buildPkg(fight);
    const envelope = buildWclRunRawPayloadV1({
      capabilityPackage: pkg,
      masterData: MASTER_DATA,
      regionCode: REGION,
    });
    await db.prisma.wclRunRaw.upsert({
      where: {
        reportCode_fightId_reportRevision_acquisitionVersion: {
          ...fight,
          acquisitionVersion: SCORING_ACQUISITION_VERSION,
        },
      },
      create: {
        ...fight,
        acquisitionVersion: SCORING_ACQUISITION_VERSION,
        payload: envelope,
        fetchedAt: new Date(),
        providerCost: null,
      },
      update: { payload: envelope },
    });

    const ports = createProductionRunOrchestrationPorts({
      prisma: db.prisma,
      artifacts: { readVerified: async () => Buffer.from("{}") } as never,
      evidence: { findDatasetByCompatibilityKey: async () => null } as never,
      targetCharacter: targetCharacter({
        characterName: "NobodyHere",
        realmSlug: "archimonde",
      }),
    });

    const participants = await ports.resolveParticipantsForFight({
      sourceFight: fight,
    });
    expect(participants).toHaveLength(5);
    expect(participants.every((p) => p.characterId == null)).toBe(true);

    const hit = await ports.findCompatibleCapabilityPackage({ sourceFight: fight });
    const built = (
      await import("@mplus/provider-warcraftlogs")
    ).buildParticipantScoringDigestsFromPackage({
      capabilityPackage: pkg,
      packageArtifactId: hit!.packageArtifactId,
      participants,
      dungeonSlug: "skyreach",
      keyLevel: 16,
      timed: true,
      runScore: 400,
      completedAt: "2026-01-01T00:00:00.000Z",
      fightStartMs: 0,
      fightEndMs: 1000,
      catalogVersion: pkg.catalogVersion,
    });
    for (const d of built) await ports.persistDigest(d);

    const scope: EvidenceSelectionScope = {
      characterId: TARGET_ID,
      seasonId: "season-1",
      seasonSlug: "s1",
      specializationId: null,
      classSlug: "warlock",
      specSlug: "demonology",
      role: "DPS",
      refreshContractHash: "missing-target",
      selectorVersion: EVIDENCE_SELECTOR_VERSION,
      evidenceCutoffAt: "2099-01-01T00:00:00.000Z",
      highKeyPolicyId: "p1",
      activeDungeonSlugs: ["skyreach"],
    };
    const candidates: EvidenceCandidateMetadataV2[] = [
      {
        discoveryIdentity: { reportCode: fight.reportCode, fightId: fight.fightId },
        reportRevision: fight.reportRevision,
        dungeonSlug: "skyreach",
        keyLevel: 16,
        timed: true,
        runScore: 400,
        evidenceCompleteness: 1,
        completedAt: "2026-01-01T00:00:00.000Z",
        fightDurationMs: 1_800_000,
        actorId: 1,
        accessState: "PUBLIC",
        identityResolution: "RESOLVED",
        fightAccessible: true,
        hardError: false,
      },
      {
        discoveryIdentity: { reportCode: "filler", fightId: 2 },
        reportRevision: 1,
        dungeonSlug: "skyreach",
        keyLevel: 14,
        timed: true,
        runScore: 300,
        evidenceCompleteness: 1,
        completedAt: "2026-01-01T00:00:00.000Z",
        fightDurationMs: 1_800_000,
        actorId: 1,
        accessState: "PUBLIC",
        identityResolution: "RESOLVED",
        fightAccessible: true,
        hardError: false,
      },
    ];

    const result = await orchestrateScoringRuns({
      characterId: TARGET_ID,
      characterName: "NobodyHere",
      region: REGION,
      realm: REALM,
      seasonId: "season-1",
      scoringModelId: "model-1",
      liveProviderPermission: "FORBIDDEN",
      scope,
      candidates,
      ports,
    });

    expect(result.targetDigestFailures.length).toBeGreaterThan(0);
    expect(
      result.targetDigestFailures.every(
        (f) => f.code === "TARGET_CHARACTER_DIGEST_MISSING",
      ),
    ).toBe(true);
    expect(result.characterDigests).toHaveLength(0);
    expect(db.digestsByKey.size).toBe(5);
  });

  it("H: production roster path does not call legacy wclRunSourceDigest", async () => {
    const db = createInMemoryScoringPrisma();
    const legacyFind = vi.fn(async () => {
      throw new Error("legacy_roster_repository_must_not_be_called");
    });
    (db.prisma as { wclRunSourceDigest?: unknown }).wclRunSourceDigest = {
      findFirst: legacyFind,
    };
    (db.prisma as { capabilityEvidencePackageRecord?: unknown }).capabilityEvidencePackageRecord =
      {
        findFirst: legacyFind,
      };

    const fight: SourceFightIdentity = {
      reportCode: "NoLegacy",
      fightId: 1,
      reportRevision: 1,
    };
    const pkg = buildPkg(fight);
    const envelope = buildWclRunRawPayloadV1({
      capabilityPackage: pkg,
      masterData: MASTER_DATA,
      regionCode: REGION,
    });
    await db.prisma.wclRunRaw.upsert({
      where: {
        reportCode_fightId_reportRevision_acquisitionVersion: {
          ...fight,
          acquisitionVersion: SCORING_ACQUISITION_VERSION,
        },
      },
      create: {
        ...fight,
        acquisitionVersion: SCORING_ACQUISITION_VERSION,
        payload: envelope,
        fetchedAt: new Date(),
        providerCost: null,
      },
      update: { payload: envelope },
    });

    const ports = createProductionRunOrchestrationPorts({
      prisma: db.prisma,
      artifacts: { readVerified: async () => Buffer.from("{}") } as never,
      evidence: { findDatasetByCompatibilityKey: async () => null } as never,
      targetCharacter: targetCharacter(),
    });

    const participants = await ports.resolveParticipantsForFight({
      sourceFight: fight,
    });
    const roster = await ports.resolveFightRoster!({ sourceFight: fight });
    expect(participants).toHaveLength(5);
    expect(roster).toHaveLength(5);
    expect(legacyFind).not.toHaveBeenCalled();
    expect(sourceFightKey(fight)).toContain("NoLegacy");
  });
});
