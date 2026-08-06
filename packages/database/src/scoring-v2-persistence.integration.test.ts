import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertTestDatabaseAllowed, sanitizeDatabaseUrl } from "@mplus/test-utils";
import {
  type ArtifactRepository,
  checkDatabaseHealth,
  createArtifactRepository,
  createPrismaClient,
  EvidenceRepository,
  type PrismaClient,
} from "./index.js";

const databaseUrl = process.env.DATABASE_URL ?? "";
assertTestDatabaseAllowed(databaseUrl);

const prisma: PrismaClient = createPrismaClient(databaseUrl);
const health = await checkDatabaseHealth(prisma);
const dbAvailable = health.ok;

if (!dbAvailable) {
  console.warn(
    `Skipping scoring-v2 persistence tests: PostgreSQL not reachable at ${sanitizeDatabaseUrl(databaseUrl)}.`,
  );
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe.runIf(dbAvailable)("scoring v2 persistence", () => {
  let characterId: string;
  let seasonId: string;
  let dungeonId: string;
  let scoreModelId: string;
  let artifacts: ArtifactRepository;
  let evidence: EvidenceRepository;

  beforeAll(async () => {
    artifacts = createArtifactRepository(prisma);
    evidence = new EvidenceRepository(prisma);

    const region = await prisma.region.upsert({
      where: { code: "EU" },
      update: {},
      create: {
        code: "EU",
        apiHost: "https://eu.api.blizzard.com",
        localeDefault: "en_GB",
        enabled: true,
      },
    });
    let realm = await prisma.realm.findFirst({
      where: { regionId: region.id, slug: "v2-persist-realm" },
    });
    if (!realm) {
      realm = await prisma.realm.create({
        data: {
          id: randomUUID(),
          regionId: region.id,
          slug: "v2-persist-realm",
          name: "V2 Persist Realm",
        },
      });
    }
    const character = await prisma.character.create({
      data: {
        id: randomUUID(),
        regionId: region.id,
        realmId: realm.id,
        normalizedName: `v2persist${randomUUID().slice(0, 8)}`,
        displayName: "V2Persist",
        role: "DPS",
      },
    });
    characterId = character.id;

    const season =
      (await prisma.season.findFirst({
        where: { regionId: region.id, slug: "v2-persist-season" },
      })) ??
      (await prisma.season.create({
        data: {
          id: randomUUID(),
          regionId: region.id,
          slug: "v2-persist-season",
          name: "V2 Persist Season",
          blizzardSeasonId: 999101,
          startsAt: new Date("2026-01-01"),
        },
      }));
    seasonId = season.id;

    const dungeon =
      (await prisma.dungeon.findUnique({ where: { slug: "v2-persist-dungeon" } })) ??
      (await prisma.dungeon.create({
        data: {
          id: randomUUID(),
          slug: "v2-persist-dungeon",
          name: "V2 Persist Dungeon",
        },
      }));
    dungeonId = dungeon.id;

    const model = await prisma.scoreModel.create({
      data: {
        id: randomUUID(),
        key: `v2-persist-model-${randomUUID().slice(0, 8)}`,
        version: 1,
        name: "v2-persist",
        status: "DRAFT",
        config: {},
      },
    });
    scoreModelId = model.id;
  });

  it("persists artifacts with dedupe, references, and orphan prevention", async () => {
    const ownerId = randomUUID();
    const bytes = Buffer.from(JSON.stringify({ page: 1, events: ["a", "b"] }));
    const first = await artifacts.persist({
      provider: "WARCRAFT_LOGS",
      bytes,
      compression: "GZIP",
      artifactClass: "wcl_event_page",
      owner: { ownerType: "EvidenceDataset", ownerId },
    });
    const second = await artifacts.persist({
      provider: "WARCRAFT_LOGS",
      bytes,
      compression: "GZIP",
      owner: { ownerType: "EvidenceDataset", ownerId: randomUUID() },
    });
    expect(second.write.deduplicated).toBe(true);
    expect(second.artifactId).toBe(first.artifactId);

    const row = await prisma.rawArtifact.findUniqueOrThrow({
      where: { id: first.artifactId },
    });
    expect(row.refCount).toBeGreaterThanOrEqual(2);
    expect(row.storageUri.startsWith("pg://")).toBe(true);

    await expect(artifacts.assertDeletable(first.artifactId)).rejects.toThrow(/reference/);

    const read = await artifacts.readVerified(first.artifactId);
    expect(read.equals(bytes)).toBe(true);

    const payload = await prisma.rawArtifactPayload.findUnique({
      where: { contentHash: first.write.contentHash },
    });
    expect(payload).not.toBeNull();
    expect(payload!.payload.length).toBeGreaterThan(0);
    expect(await artifacts.verifyPayloadReadability(first.artifactId)).toBe(
      "DB_PAYLOAD_READABLE",
    );
  });

  it("rolls back manifest create on unique slot conflict inside a transaction", async () => {
    const contentHash = createHash("sha256").update(randomUUID()).digest("hex");
    const baseSlots = [
      {
        dungeonId,
        slotIndex: 0,
        reportCode: "AbCdEfGh",
        fightId: 12,
        reportRevision: 1,
        state: "SELECTED",
        keyLevel: 12,
      },
      {
        dungeonId,
        slotIndex: 1,
        reportCode: "AbCdEfGh",
        fightId: 12,
        reportRevision: 1,
        state: "SELECTED",
        keyLevel: 11,
      },
    ];

    await expect(
      evidence.createFrozenManifest({
        characterId,
        seasonId,
        role: "DPS",
        refreshContractHash: "rf",
        selectorVersion: "evidence-selector-v2.0.0",
        highKeyPolicyId: "high-key-v1",
        evidenceCutoffAt: new Date("2026-08-01T00:00:00.000Z"),
        expectedSlotCount: 2,
        selectedSlotCount: 2,
        coverageState: "PARTIAL",
        schemaVersion: "2.0.0",
        contentHash,
        document: { schemaVersion: "2.0.0", slots: [] },
        frozenAt: new Date("2026-08-01T00:00:00.000Z"),
        slots: baseSlots,
      }),
    ).rejects.toThrow();

    const orphan = await prisma.evidenceManifest.findUnique({ where: { contentHash } });
    expect(orphan).toBeNull();
  });

  it("freezes manifests immutably and enforces dataset/fact uniqueness", async () => {
    const contentHash = createHash("sha256").update(`manifest-${randomUUID()}`).digest("hex");
    const { manifest, slots, created } = await evidence.createFrozenManifest({
      characterId,
      seasonId,
      role: "DPS",
      refreshContractHash: "rf-2",
      selectorVersion: "evidence-selector-v2.0.0",
      highKeyPolicyId: "high-key-v1",
      evidenceCutoffAt: new Date("2026-08-01T00:00:00.000Z"),
      expectedSlotCount: 2,
      selectedSlotCount: 1,
      coverageState: "PARTIAL",
      schemaVersion: "2.0.0",
      contentHash,
      document: { schemaVersion: "2.0.0", note: "frozen" },
      frozenAt: new Date("2026-08-01T00:00:00.000Z"),
      slots: [
        {
          dungeonId,
          slotIndex: 0,
          reportCode: "XyZaBcDe",
          fightId: 3,
          reportRevision: 2,
          state: "SELECTED",
          keyLevel: 14,
        },
        {
          dungeonId,
          slotIndex: 1,
          state: "MISSING_NO_CANDIDATE",
        },
      ],
    });
    expect(created).toBe(true);
    expect(slots).toHaveLength(2);

    await expect(
      prisma.evidenceManifest.update({
        where: { id: manifest.id },
        data: { contentHash: createHash("sha256").update("mutate").digest("hex") },
      }),
    ).rejects.toThrow(/immutable/i);

    const slot = slots.find((s) => s.slotIndex === 0)!;
    const ownerId = randomUUID();
    const persisted = await artifacts.persist({
      provider: "WARCRAFT_LOGS",
      bytes: Buffer.from('{"events":[]}'),
      compression: "GZIP",
      owner: { ownerType: "EvidenceDataset", ownerId },
    });

    const dataset = await evidence.createDataset({
      manifestSlotId: slot.id,
      datasetKey: "damageDone",
      compatibilityKey: `compat-${randomUUID()}`,
      artifactId: persisted.artifactId,
      schemaVersion: "1",
      providerContractVersion: "wcl-v2",
      state: "READY",
      eventCount: 0,
      pageCount: 1,
    });
    expect(dataset.compatibilityKey).toBeTruthy();

    await expect(
      evidence.createDataset({
        manifestSlotId: slot.id,
        datasetKey: "damageDone",
        compatibilityKey: `compat-${randomUUID()}`,
        schemaVersion: "1",
        providerContractVersion: "wcl-v2",
        state: "READY",
      }),
    ).rejects.toThrow();

    const fact = await evidence.createFactSet({
      manifestSlotId: slot.id,
      characterId,
      extractorFamily: "survival",
      extractorVersion: "1.0.0",
      schemaVersion: "1",
      inputFingerprint: "fp-1",
      facts: { deaths: 0 },
      computedAt: new Date(),
    });
    expect(fact.id).toBeTruthy();

    await expect(
      evidence.createFactSet({
        manifestSlotId: slot.id,
        characterId,
        extractorFamily: "survival",
        extractorVersion: "1.0.0",
        schemaVersion: "1",
        inputFingerprint: "fp-1",
        facts: { deaths: 1 },
        computedAt: new Date(),
      }),
    ).rejects.toThrow();

    const dim = await evidence.createDimensionComputation({
      characterId,
      seasonId,
      manifestId: manifest.id,
      scoreModelId,
      dimension: "SURVIVAL",
      algorithmVersion: "survival-v2-phase1",
      inputFingerprint: "dim-fp-1",
      score: 72.5,
      confidence: 0.8,
      state: "AVAILABLE",
      computedAt: new Date(),
    });
    expect(dim.manifestId).toBe(manifest.id);

    await prisma.scoreSnapshot.create({
      data: {
        id: randomUUID(),
        characterId,
        seasonId,
        scoreModelId,
        scopeType: "CHARACTER",
        overallScore: 70,
        grade: "B",
        skillScore: 70,
        authenticityScore: 70,
        confidence: 0.8,
        calculatedAt: new Date(),
        inputFingerprint: `snap-${randomUUID()}`,
        evidenceManifestId: manifest.id,
        publicationStatus: "DRAFT",
        isPublic: false,
      },
    });
  });

  it("rejects SHA-256 content hashes as ArtifactReference.ownerId before Prisma", async () => {
    const sha256 = createHash("sha256").update("not-a-uuid-owner").digest("hex");
    expect(sha256).toHaveLength(64);
    await expect(
      artifacts.persist({
        provider: "WARCRAFT_LOGS",
        bytes: Buffer.from('{"probe":true}'),
        compression: "GZIP",
        artifactClass: "participant_scoring_digest_v1",
        owner: {
          ownerType: "ParticipantScoringDigest",
          ownerId: sha256,
        },
      }),
    ).rejects.toMatchObject({
      code: "ARTIFACT_INVALID_OWNER_ID",
      ownerType: "ParticipantScoringDigest",
      looksLikeSha256Hex: true,
    });
  });

  it("binds package artifact references to the package record UUID and keeps supersession keys as strings", async () => {
    const packageId = randomUUID();
    const priorKey = `prior-compat-${randomUUID()}`;
    const compatKey = `compat-${randomUUID()}`;
    const contentHash = createHash("sha256").update(`pkg-${randomUUID()}`).digest("hex");
    expect(contentHash).toHaveLength(64);

    const write = await artifacts.persist({
      provider: "WARCRAFT_LOGS",
      bytes: Buffer.from(JSON.stringify({ packageProbe: true, contentHash })),
      compression: "GZIP",
      artifactClass: "canonical_capability_evidence_v1",
    });

    await prisma.capabilityEvidencePackageRecord.create({
      data: {
        id: packageId,
        compatibilityKey: compatKey,
        reportCode: "OwnerUuid1",
        fightId: 9,
        reportRevision: 1,
        actorSetHash: "actors:x",
        abilityFilterHash: "abilities:x",
        catalogVersion: "catalog-test",
        acquisitionPlanVersion: "plan-v1",
        graphqlQueryVersion: "gql-v1",
        mode: "PRODUCTION_CAPABILITY_ACQUISITION",
        contentHash,
        artifactId: write.artifactId,
        participantActorIds: [1, 2, 3, 4, 5],
        complete: true,
        supersedesCompatibilityKey: priorKey,
      },
    });

    const linked = await artifacts.ensureOwnerReference({
      artifactId: write.artifactId,
      ownerType: "CapabilityEvidencePackage",
      ownerId: packageId,
      artifactClass: "canonical_capability_evidence_v1",
    });
    expect(linked.created).toBe(true);

    const retry = await artifacts.ensureOwnerReference({
      artifactId: write.artifactId,
      ownerType: "CapabilityEvidencePackage",
      ownerId: packageId,
    });
    expect(retry.created).toBe(false);

    const refs = await prisma.artifactReference.findMany({
      where: { artifactId: write.artifactId, ownerType: "CapabilityEvidencePackage" },
    });
    expect(refs).toHaveLength(1);
    expect(refs[0]!.ownerId).toBe(packageId);
    expect(refs[0]!.ownerId).not.toBe(contentHash);
    expect(refs[0]!.ownerId).not.toBe(priorKey);

    const row = await prisma.capabilityEvidencePackageRecord.findUniqueOrThrow({
      where: { id: packageId },
    });
    expect(row.supersedesCompatibilityKey).toBe(priorKey);
    expect(typeof row.supersedesCompatibilityKey).toBe("string");
  });

  it("binds digest artifact references to the digest record UUID, not contentHash", async () => {
    const digestId = randomUUID();
    const contentHash = createHash("sha256").update(`digest-${randomUUID()}`).digest("hex");
    const packageArtifactId = (
      await artifacts.persist({
        provider: "WARCRAFT_LOGS",
        bytes: Buffer.from('{"pkg":1}'),
        compression: "GZIP",
        artifactClass: "canonical_capability_evidence_v1",
      })
    ).artifactId;
    const write = await artifacts.persist({
      provider: "WARCRAFT_LOGS",
      bytes: Buffer.from(JSON.stringify({ digestProbe: true, contentHash })),
      compression: "GZIP",
      artifactClass: "participant_scoring_digest_v1",
    });

    await prisma.participantScoringDigest.create({
      data: {
        id: digestId,
        compatibilityKey: `digest-compat-${randomUUID()}`,
        reportCode: "OwnerDig1",
        fightId: 2,
        reportRevision: 1,
        participantActorId: 10,
        characterId,
        digestSchemaVersion: "participant-scoring-digest-v1",
        extractorCompatVersion: "extractor-v1",
        catalogVersion: "catalog-test",
        capabilityPackageContentHash: createHash("sha256").update("pkg").digest("hex"),
        capabilityPackageArtifactId: packageArtifactId,
        contentHash,
        artifactId: write.artifactId,
      },
    });

    await artifacts.ensureOwnerReference({
      artifactId: write.artifactId,
      ownerType: "ParticipantScoringDigest",
      ownerId: digestId,
      artifactClass: "participant_scoring_digest_v1",
    });

    const ref = await prisma.artifactReference.findUniqueOrThrow({
      where: {
        ownerType_ownerId_artifactId: {
          ownerType: "ParticipantScoringDigest",
          ownerId: digestId,
          artifactId: write.artifactId,
        },
      },
    });
    expect(ref.ownerId).toBe(digestId);
    expect(ref.ownerId).not.toBe(contentHash);
    expect(contentHash).toHaveLength(64);
  });
});
