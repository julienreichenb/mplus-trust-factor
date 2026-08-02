import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertTestDatabaseAllowed, sanitizeDatabaseUrl } from "@mplus/test-utils";
import {
  checkDatabaseHealth,
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
    `Skipping dimension-computation idempotent tests: PostgreSQL not reachable at ${sanitizeDatabaseUrl(databaseUrl)}.`,
  );
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe.runIf(dbAvailable)("DimensionComputation logical uniqueness", () => {
  let characterId: string;
  let seasonId: string;
  let dungeonId: string;
  let scoreModelId: string;
  let evidence: EvidenceRepository;

  beforeAll(async () => {
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
      where: { regionId: region.id, slug: "v2-dim-idem-realm" },
    });
    if (!realm) {
      realm = await prisma.realm.create({
        data: {
          id: randomUUID(),
          regionId: region.id,
          slug: "v2-dim-idem-realm",
          name: "V2 Dim Idem Realm",
        },
      });
    }
    const character = await prisma.character.create({
      data: {
        id: randomUUID(),
        regionId: region.id,
        realmId: realm.id,
        normalizedName: `v2dimidem${randomUUID().slice(0, 8)}`,
        displayName: "V2DimIdem",
        role: "DPS",
      },
    });
    characterId = character.id;

    const season =
      (await prisma.season.findFirst({
        where: { regionId: region.id, slug: "v2-dim-idem-season" },
      })) ??
      (await prisma.season.create({
        data: {
          id: randomUUID(),
          regionId: region.id,
          slug: "v2-dim-idem-season",
          name: "V2 Dim Idem Season",
          blizzardSeasonId: 999201,
          startsAt: new Date("2026-01-01"),
        },
      }));
    seasonId = season.id;

    const dungeon =
      (await prisma.dungeon.findUnique({ where: { slug: "v2-dim-idem-dungeon" } })) ??
      (await prisma.dungeon.create({
        data: {
          id: randomUUID(),
          slug: "v2-dim-idem-dungeon",
          name: "V2 Dim Idem Dungeon",
        },
      }));
    dungeonId = dungeon.id;

    const model = await prisma.scoreModel.create({
      data: {
        id: randomUUID(),
        key: `v2-dim-idem-model-${randomUUID().slice(0, 8)}`,
        version: 1,
        name: "v2-dim-idem",
        status: "DRAFT",
        config: {},
      },
    });
    scoreModelId = model.id;
  });

  async function createManifest() {
    const contentHash = createHash("sha256").update(randomUUID()).digest("hex");
    const { manifest } = await evidence.createFrozenManifest({
      characterId,
      seasonId,
      role: "DPS",
      refreshContractHash: "refresh",
      selectorVersion: "sel-1",
      highKeyPolicyId: "hk-1",
      evidenceCutoffAt: new Date("2026-08-01T00:00:00.000Z"),
      expectedSlotCount: 1,
      selectedSlotCount: 1,
      coverageState: "PARTIAL",
      schemaVersion: "2.0.0",
      contentHash,
      document: { contentHash },
      frozenAt: new Date(),
      slots: [
        {
          dungeonId,
          slotIndex: 0,
          reportCode: "AbCdEfGh",
          fightId: 1,
          reportRevision: 1,
          state: "SELECTED",
          keyLevel: 12,
        },
      ],
    });
    return manifest;
  }

  function baseInput(manifestId: string, fingerprint: string, score = 70) {
    return {
      characterId,
      seasonId,
      manifestId,
      scoreModelId,
      dimension: "PERFORMANCE" as const,
      algorithmVersion: "performance-v2.phase1.0.1.0",
      inputFingerprint: fingerprint,
      score,
      confidence: 0.8,
      state: "SHADOW",
      metrics: { availabilityState: "AVAILABLE", publicationBlocked: true },
      explanation: { mode: "test" },
      computedAt: new Date("2026-08-01T12:00:00.000Z"),
    };
  }

  it("identical concurrent writes return one logical row", async () => {
    const manifest = await createManifest();
    const input = baseInput(manifest.id, "fp-same");

    const [a, b] = await Promise.all([
      evidence.createDimensionComputationIdempotent(input),
      evidence.createDimensionComputationIdempotent(input),
    ]);

    expect(a.row.id).toBe(b.row.id);
    expect([a.created, b.created].filter(Boolean)).toHaveLength(1);

    const rows = await prisma.dimensionComputation.findMany({
      where: {
        characterId,
        seasonId,
        manifestId: manifest.id,
        scoreModelId,
        dimension: "PERFORMANCE",
      },
    });
    expect(rows).toHaveLength(1);
  });

  it("conflicting concurrent fingerprints: one succeeds, one fails, no duplicates", async () => {
    const manifest = await createManifest();
    const left = baseInput(manifest.id, "fp-left", 70);
    const right = baseInput(manifest.id, "fp-right", 71);

    const results = await Promise.allSettled([
      evidence.createDimensionComputationIdempotent(left),
      evidence.createDimensionComputationIdempotent(right),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const err = (rejected[0] as PromiseRejectedResult).reason as Error;
    expect(err.message).toContain("dimension_computation_conflict");
    expect(err.message).toContain("reason=fingerprint_mismatch");
    expect(err.message).toContain("logicalIdentity=");
    expect(err.message).toMatch(/existingFingerprint=fp-(left|right)/);
    expect(err.message).toMatch(/requestedFingerprint=fp-(left|right)/);

    const rows = await prisma.dimensionComputation.findMany({
      where: {
        characterId,
        seasonId,
        manifestId: manifest.id,
        scoreModelId,
        dimension: "PERFORMANCE",
      },
    });
    expect(rows).toHaveLength(1);
  });

  it("redelivery of identical content returns existing row", async () => {
    const manifest = await createManifest();
    const input = baseInput(manifest.id, "fp-redeliver");
    const first = await evidence.createDimensionComputationIdempotent(input);
    expect(first.created).toBe(true);
    const second = await evidence.createDimensionComputationIdempotent(input);
    expect(second.created).toBe(false);
    expect(second.row.id).toBe(first.row.id);
  });

  it("raw create with different fingerprint for same logical identity fails at DB", async () => {
    const manifest = await createManifest();
    await evidence.createDimensionComputation(baseInput(manifest.id, "fp-a"));
    await expect(
      evidence.createDimensionComputation(baseInput(manifest.id, "fp-b")),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});
