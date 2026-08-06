/**
 * Regression: ArtifactReference.ownerId must be the owning row UUID.
 * Never contentHash / compatibilityKey / supersedesCompatibilityKey.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { assertTestDatabaseAllowed } from "@mplus/test-utils";
import {
  ArtifactInvalidOwnerIdError,
  CapabilityEvidencePackageRepository,
  ParticipantScoringDigestRepository,
  assertArtifactOwnerIdIsUuid,
  checkDatabaseHealth,
  createArtifactRepository,
  createPrismaClient,
  selectCurrentCompatiblePackageRow,
  type PrismaClient,
} from "@mplus/database";
import {
  PARTICIPANT_DIGEST_EXTRACTOR_COMPAT_VERSION,
  PARTICIPANT_SCORING_DIGEST_SCHEMA_VERSION,
  withParticipantDigestContentHash,
} from "@mplus/contracts";
import { buildMinimalCapabilityPackage } from "./run-orchestration/memory-ports.js";
import { persistCapabilityPackageToPostgres } from "./run-orchestration/production-ports.js";
import { persistParticipantDigestWithRowOwner } from "./run-orchestration/persist-digest-artifact.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../../..");
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

describe("artifact owner UUID semantics (unit)", () => {
  it("never treats a 64-char digest contentHash as a UUID ownerId", () => {
    const contentHash = createHash("sha256").update("digest-payload").digest("hex");
    expect(contentHash).toHaveLength(64);
    expect(() =>
      assertArtifactOwnerIdIsUuid({
        ownerType: "ParticipantScoringDigest",
        ownerId: contentHash,
        artifactClass: "participant_scoring_digest_v1",
      }),
    ).toThrow(ArtifactInvalidOwnerIdError);
  });

  it("keeps supersedesCompatibilityKey as a distinct string hash/key field", () => {
    const prior = {
      compatibilityKey: "prior-key",
      supersedesCompatibilityKey: null as string | null,
      updatedAt: new Date("2026-01-01"),
    };
    const next = {
      compatibilityKey: "next-key",
      supersedesCompatibilityKey: "prior-key",
      updatedAt: new Date("2026-01-02"),
    };
    expect(selectCurrentCompatiblePackageRow([prior, next])?.compatibilityKey).toBe(
      "next-key",
    );
    expect(prior.supersedesCompatibilityKey).toBeNull();
    expect(typeof next.supersedesCompatibilityKey).toBe("string");
    expect(next.supersedesCompatibilityKey).not.toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("does not reintroduce contextual operator scripts", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["scoring-v2:canary"]).toBeTruthy();
    expect(pkg.scripts["scoring-v2:replay"]).toBeTruthy();
    expect(pkg.scripts["scoring-v2:doctor"]).toBeTruthy();
    expect(pkg.scripts["scoring-v2:canary:repair-package"]).toBeUndefined();
    expect(pkg.scripts["scoring-v2:canary:ranking-hydrate"]).toBeUndefined();
  });

  it("production persist helpers never pass contentHash as ownerId", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const files = [
      join(here, "run-orchestration/persist-digest-artifact.ts"),
      join(here, "run-orchestration/production-ports.ts"),
      join(here, "run-orchestration/self-healing-evidence.ts"),
      join(here, "canary/canary-repair-package.ts"),
    ];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect(text).not.toMatch(/ownerId:\s*digest\.contentHash/);
      expect(text).not.toMatch(/ownerId:\s*pkg\.contentHash/);
      expect(text).not.toMatch(/ownerId:\s*prior\.package\.compatibilityKey/);
      expect(text).not.toMatch(/ownerId:\s*.*supersedesCompatibilityKey/);
    }
  });
});

describe.runIf(isolated && dbAvailable)("artifact owner UUID persistence (db)", () => {
  const db = prisma!;
  const artifacts = createArtifactRepository(db);
  const packages = new CapabilityEvidencePackageRepository(db, artifacts);
  const digests = new ParticipantScoringDigestRepository(db, artifacts);

  it("persistCapabilityPackageToPostgres uses package record UUID as owner", async () => {
    const reportCode = `Own${randomUUID().replace(/-/g, "").slice(0, 13)}`;
    const sourceFight = { reportCode, fightId: 3, reportRevision: 1 };
    const priorKey = `prior-${randomUUID()}`;
    const pkg = buildMinimalCapabilityPackage({
      sourceFight,
      participants: [11, 12, 13, 14, 15].map((playerActorId) => ({
        playerActorId,
        characterName: `A${playerActorId}`,
        classSlug: null,
        specSlug: null,
        role: null,
        ownedPetActorIds: [],
        characterId: null,
      })),
    });

    const first = await persistCapabilityPackageToPostgres({
      artifacts,
      packages,
      package: pkg,
      supersedesCompatibilityKey: priorKey,
    });
    const indexed = await packages.findByCompatibilityKey(pkg.compatibilityKey);
    expect(indexed).not.toBeNull();
    expect(indexed!.recordId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );

    const ref = await db.artifactReference.findUniqueOrThrow({
      where: {
        ownerType_ownerId_artifactId: {
          ownerType: "CapabilityEvidencePackage",
          ownerId: indexed!.recordId,
          artifactId: first.packageArtifactId,
        },
      },
    });
    expect(ref.ownerId).toBe(indexed!.recordId);
    expect(ref.ownerId).not.toBe(pkg.contentHash);
    expect(ref.ownerId).not.toBe(priorKey);

    const row = await db.capabilityEvidencePackageRecord.findUniqueOrThrow({
      where: { id: indexed!.recordId },
    });
    expect(row.supersedesCompatibilityKey).toBe(priorKey);

    const second = await persistCapabilityPackageToPostgres({
      artifacts,
      packages,
      package: pkg,
      supersedesCompatibilityKey: priorKey,
    });
    expect(second.packageArtifactId).toBe(first.packageArtifactId);
    const refs = await db.artifactReference.count({
      where: {
        artifactId: first.packageArtifactId,
        ownerType: "CapabilityEvidencePackage",
        ownerId: indexed!.recordId,
      },
    });
    expect(refs).toBe(1);
  });

  it("persistParticipantDigestWithRowOwner uses digest record UUID as owner", async () => {
    const contentSeed = randomUUID();
    const digest = withParticipantDigestContentHash({
      schemaVersion: PARTICIPANT_SCORING_DIGEST_SCHEMA_VERSION,
      extractorCompatVersion: PARTICIPANT_DIGEST_EXTRACTOR_COMPAT_VERSION,
      reportCode: `Dg${randomUUID().replace(/-/g, "").slice(0, 14)}`,
      fightId: 4,
      reportRevision: 1,
      participantActorId: 42,
      characterId: null,
      characterName: "Probe",
      classSlug: null,
      specSlug: null,
      role: "DPS",
      ownedPetActorIds: [],
      dungeonSlug: "probe",
      keyLevel: 10,
      timed: true,
      runScore: null,
      completedAt: null,
      catalogVersion: "catalog-test-v1",
      capabilityPackageArtifactId: randomUUID(),
      capabilityPackageContentHash: createHash("sha256")
        .update(`pkg-${contentSeed}`)
        .digest("hex"),
      performance: {
        parsePercentile: null,
        parseSemantic: "UNAVAILABLE",
        partition: null,
        rawDps: null,
        offensiveActivations: [],
        completeness: "PARTIAL",
        limitations: [],
      },
      utility: {
        actions: [],
        capabilityCompleteness: [],
        completeness: "COMPLETE",
        limitations: [],
      },
      survival: {
        damageTakenTotal: 0,
        damageTakenEventCount: 0,
        deaths: [],
        personalDefensiveActivations: [],
        recoveryActivations: [],
        externalsReceived: [],
        pressureWindows: [],
        fightDurationMs: 1000,
        activeCombatMs: 1000,
        capabilityCompleteness: [],
        completeness: "COMPLETE",
        limitations: [],
      },
      createdAt: "2026-08-06T12:00:00.000Z",
    });
    expect(digest.contentHash).toHaveLength(64);

    const persisted = await persistParticipantDigestWithRowOwner({
      artifacts,
      digests,
      digest,
    });
    expect(persisted.digestRecordId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(persisted.digestRecordId).not.toBe(digest.contentHash);

    const ref = await db.artifactReference.findUniqueOrThrow({
      where: {
        ownerType_ownerId_artifactId: {
          ownerType: "ParticipantScoringDigest",
          ownerId: persisted.digestRecordId,
          artifactId: persisted.artifactId,
        },
      },
    });
    expect(ref.ownerId).toBe(persisted.digestRecordId);

    const again = await persistParticipantDigestWithRowOwner({
      artifacts,
      digests,
      digest,
    });
    expect(again.digestRecordId).toBe(persisted.digestRecordId);
    expect(again.created).toBe(false);
    const refCount = await db.artifactReference.count({
      where: {
        ownerType: "ParticipantScoringDigest",
        ownerId: persisted.digestRecordId,
        artifactId: persisted.artifactId,
      },
    });
    expect(refCount).toBe(1);
  });
});
