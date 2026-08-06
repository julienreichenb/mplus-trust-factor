/**
 * Provider-free package supersession lookup + upsert sanitization.
 */
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { assertTestDatabaseAllowed } from "@mplus/test-utils";
import {
  CapabilityEvidencePackageRepository,
  checkDatabaseHealth,
  createArtifactRepository,
  createPrismaClient,
  selectCanonicalCompatiblePackageHead,
  type PrismaClient,
} from "@mplus/database";
import {
  buildMinimalCapabilityPackage,
  createMemoryOrchestrationPorts,
} from "./run-orchestration/memory-ports.js";
import { persistCapabilityPackageToPostgres } from "./run-orchestration/production-ports.js";
import {
  orchestrateScoringV2Runs,
  replayScoringV2FromPersistedEvidence,
} from "./run-orchestration/orchestrator.js";
import { MIDNIGHT_SEASON_1_DUNGEON_SLUGS } from "./canary/canary-catalog.js";
import { EVIDENCE_SELECTOR_VERSION } from "@mplus/contracts";

const isolated = process.env.MPLUS_ISOLATED_TEST_DB === "true";
const databaseUrl = process.env.DATABASE_URL ?? "";
let prisma: PrismaClient | null = null;
let dbAvailable = false;
if (isolated) {
  assertTestDatabaseAllowed(databaseUrl);
  prisma = createPrismaClient(databaseUrl);
  dbAvailable = (await checkDatabaseHealth(prisma)).ok;
}

afterAll(async () => {
  await prisma?.$disconnect();
});

describe("real canary supersession shape (unit, no WCL)", () => {
  it("selects the successor head for the observed Rycg self-supersession corruption", () => {
    const oldKey =
      "wcl-capability-evidence|RycgPJ9rjxT6v1Bw|r11|f17|PACKAGE|caps:cb591fc3f416a243|actors:d7ea61681b2e66a3|abilities:37003bce15ac1660|catalog:12.0.0/midnight-season-1|capability-acquisition-plan-v1|wcl-graphql-v2-events|PRODUCTION_CAPABILITY_ACQUISITION";
    const newKey =
      "wcl-capability-evidence|RycgPJ9rjxT6v1Bw|r11|f17|PACKAGE|caps:cb591fc3f416a243|actors:57061ae89d4459a9|abilities:37003bce15ac1660|catalog:12.0.0/midnight-season-1|capability-acquisition-plan-v1|wcl-graphql-v2-events|PRODUCTION_CAPABILITY_ACQUISITION";
    const selected = selectCanonicalCompatiblePackageHead([
      {
        id: "69fd239c-11f3-4d5e-9e1e-b723104bd56b",
        compatibilityKey: oldKey,
        supersedesCompatibilityKey: null,
        updatedAt: new Date("2026-08-05T21:39:01.999Z"),
        createdAt: new Date("2026-08-05T21:39:01.999Z"),
        reportCode: "RycgPJ9rjxT6v1Bw",
        fightId: 17,
        reportRevision: 11,
      },
      {
        id: "6a207360-9bd6-403c-a936-4cce599bdc33",
        compatibilityKey: newKey,
        supersedesCompatibilityKey: newKey,
        updatedAt: new Date("2026-08-06T14:28:15.636Z"),
        createdAt: new Date("2026-08-06T14:09:08.969Z"),
        reportCode: "RycgPJ9rjxT6v1Bw",
        fightId: 17,
        reportRevision: 11,
      },
    ]);
    expect(selected.head.id).toBe("6a207360-9bd6-403c-a936-4cce599bdc33");
    expect(selected.supersededKeys).toEqual([oldKey]);
  });
});

describe.runIf(isolated && dbAvailable)("package supersession persistence (db, no WCL)", () => {
  const db = prisma!;
  const artifacts = createArtifactRepository(db);
  const packages = new CapabilityEvidencePackageRepository(db, artifacts);

  it("retry reuses the canonical head without duplicating superseding rows", async () => {
    const reportCode = `Sp${randomUUID().replace(/-/g, "").slice(0, 14)}`;
    const sourceFight = { reportCode, fightId: 7, reportRevision: 2 };
    const participants = [1, 2, 3, 4, 5].map((playerActorId) => ({
      playerActorId,
      characterName: `P${playerActorId}`,
      classSlug: null,
      specSlug: null,
      role: null as const,
      ownedPetActorIds: [] as number[],
      characterId: null,
    }));
    const priorPkg = buildMinimalCapabilityPackage({ sourceFight, participants });
    await persistCapabilityPackageToPostgres({
      artifacts,
      packages,
      package: priorPkg,
      supersedesCompatibilityKey: null,
    });

    const nextParticipants = [1, 2, 3, 4, 99].map((playerActorId) => ({
      playerActorId,
      characterName: `P${playerActorId}`,
      classSlug: null,
      specSlug: null,
      role: null as const,
      ownedPetActorIds: [] as number[],
      characterId: null,
    }));
    const nextPkg = buildMinimalCapabilityPackage({
      sourceFight,
      participants: nextParticipants,
    });
    expect(nextPkg.compatibilityKey).not.toBe(priorPkg.compatibilityKey);

    const first = await persistCapabilityPackageToPostgres({
      artifacts,
      packages,
      package: nextPkg,
      supersedesCompatibilityKey: priorPkg.compatibilityKey,
    });
    const head1 = await packages.findCompleteBySourceFight(sourceFight);
    expect(head1?.recordId).toBeTruthy();
    expect(head1!.contentHash).toBe(nextPkg.contentHash);
    expect(head1!.package.compatibilityKey).toBe(nextPkg.compatibilityKey);

    // Corrupt self-supersession write attempt is sanitized back to the prior key.
    const second = await persistCapabilityPackageToPostgres({
      artifacts,
      packages,
      package: nextPkg,
      supersedesCompatibilityKey: nextPkg.compatibilityKey,
    });
    expect(second.packageArtifactId).toBe(first.packageArtifactId);
    const head2 = await packages.findCompleteBySourceFight(sourceFight);
    expect(head2!.recordId).toBe(head1!.recordId);
    expect(head2!.contentHash).toBe(nextPkg.contentHash);

    const rows = await db.capabilityEvidencePackageRecord.findMany({
      where: {
        reportCode,
        fightId: 7,
        reportRevision: 2,
      },
    });
    expect(rows).toHaveLength(2);
    const successor = rows.find((r) => r.compatibilityKey === nextPkg.compatibilityKey)!;
    expect(successor.supersedesCompatibilityKey).toBe(priorPkg.compatibilityKey);
    expect(successor.supersedesCompatibilityKey).not.toBe(successor.compatibilityKey);
  });
});

describe("consolidated warm path after canonical lookup (memory, no WCL)", () => {
  it("reaches digest generation and zero-provider replay after package head reuse", async () => {
    const CHAR_ID = "22222222-2222-4222-8222-222222222222";
    const ports = createMemoryOrchestrationPorts({ providerCallsPerAcquire: 1 });
    const scope = {
      characterId: CHAR_ID,
      seasonId: "season-1",
      seasonSlug: "s1",
      specializationId: null,
      classSlug: "mage",
      specSlug: "fire",
      role: "DPS" as const,
      refreshContractHash: "rh",
      selectorVersion: EVIDENCE_SELECTOR_VERSION,
      evidenceCutoffAt: "2099-01-01T00:00:00.000Z",
      highKeyPolicyId: "h",
      activeDungeonSlugs: [...MIDNIGHT_SEASON_1_DUNGEON_SLUGS],
    };
    const candidates = MIDNIGHT_SEASON_1_DUNGEON_SLUGS.flatMap((slug, i) => [
      {
        discoveryIdentity: { reportCode: `R${i}a`, fightId: 1 },
        reportRevision: 1,
        dungeonSlug: slug,
        keyLevel: 20,
        timed: true,
        runScore: 400,
        evidenceCompleteness: 1,
        completedAt: "2026-01-01T00:00:00.000Z",
        fightDurationMs: 1_800_000,
        actorId: 10,
        accessState: "PUBLIC" as const,
        identityResolution: "RESOLVED" as const,
        fightAccessible: true,
        hardError: false,
        discoverySource: "test",
      },
      {
        discoveryIdentity: { reportCode: `R${i}b`, fightId: 2 },
        reportRevision: 1,
        dungeonSlug: slug,
        keyLevel: 19,
        timed: true,
        runScore: 390,
        evidenceCompleteness: 1,
        completedAt: "2026-01-02T00:00:00.000Z",
        fightDurationMs: 1_800_000,
        actorId: 10,
        accessState: "PUBLIC" as const,
        identityResolution: "RESOLVED" as const,
        fightAccessible: true,
        hardError: false,
        discoverySource: "test",
      },
    ]);

    for (const c of candidates) {
      ports.setParticipants(
        {
          reportCode: c.discoveryIdentity.reportCode,
          fightId: c.discoveryIdentity.fightId,
          reportRevision: 1,
        },
        [10, 11, 12, 13, 14].map((id) => ({
          playerActorId: id,
          characterName: id === 10 ? "Target" : `P${id}`,
          classSlug: "mage",
          specSlug: "fire",
          role: "DPS",
          ownedPetActorIds: [],
          characterId: id === 10 ? CHAR_ID : null,
        })),
      );
    }

    const cold = await orchestrateScoringV2Runs({
      characterId: CHAR_ID,
      region: "eu",
      realm: "test",
      characterName: "Target",
      seasonId: "season-1",
      scoringModelId: "model-1",
      liveProviderPermission: "ALLOWED",
      scope,
      candidates,
      ports,
    });
    expect(cold.characterDigests.length).toBe(16);
    const coldCalls = ports.stats.providerCalls;

    const warm = await orchestrateScoringV2Runs({
      characterId: CHAR_ID,
      region: "eu",
      realm: "test",
      characterName: "Target",
      seasonId: "season-1",
      scoringModelId: "model-1",
      liveProviderPermission: "ALLOWED",
      scope,
      candidates,
      ports,
      existingManifest: cold.manifest,
    });
    expect(warm.characterDigests.length).toBe(16);
    expect(ports.stats.providerCalls).toBe(coldCalls);

    const replay = await replayScoringV2FromPersistedEvidence({
      characterId: CHAR_ID,
      region: "eu",
      realm: "test",
      characterName: "Target",
      seasonId: "season-1",
      scoringModelId: "model-1",
      scope,
      ports,
      existingManifest: cold.manifest,
    });
    expect(replay.accounting.providerCalls).toBe(0);
  });
});
