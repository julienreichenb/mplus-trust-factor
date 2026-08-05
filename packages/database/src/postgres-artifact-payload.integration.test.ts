/**
 * PostgreSQL-backed WCL artifact payload durability (database-only reads).
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLocalFsArtifactStore } from "@mplus/artifact-store";
import { assertTestDatabaseAllowed, sanitizeDatabaseUrl } from "@mplus/test-utils";
import {
  ArtifactLegacyExternalPayloadMissingError,
  checkDatabaseHealth,
  createArtifactRepository,
  createPrismaClient,
  type ArtifactRepository,
  type PrismaClient,
} from "./index.js";

const databaseUrl = process.env.DATABASE_URL ?? "";
assertTestDatabaseAllowed(databaseUrl);

const prisma: PrismaClient = createPrismaClient(databaseUrl);
const health = await checkDatabaseHealth(prisma);
const dbAvailable = health.ok;

if (!dbAvailable) {
  console.warn(
    `Skipping postgres artifact payload tests: PostgreSQL not reachable at ${sanitizeDatabaseUrl(databaseUrl)}.`,
  );
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe.runIf(dbAvailable)("postgres artifact payload storage", () => {
  let emptyFsRoot: string;

  beforeAll(async () => {
    emptyFsRoot = await mkdtemp(path.join(tmpdir(), "mplus-pg-art-empty-"));
  });

  function freshRepository(): ArtifactRepository {
    return createArtifactRepository(prisma);
  }

  it("persists compressed payload bytes in PostgreSQL and reloads without filesystem", async () => {
    const events = [{ type: "cast", sourceID: 10, abilityGameID: 116 }];
    const envelope = {
      schemaVersion: "wcl-event-page-v1",
      providerContractVersion: "wcl-run-evidence-v2",
      reportCode: "AbCdEfGhIjKl",
      fightId: 3,
      reportRevision: 1,
      datasetKey: "Casts",
      pageIndex: 0,
      pageCursor: null,
      nextPageCursor: null,
      filterExpression: null,
      filterSourceId: 10,
      scopeFingerprint: "scope|casts",
      truncated: false,
      events,
    };
    const bytes = Buffer.from(JSON.stringify(envelope), "utf8");

    const writer = freshRepository();
    const persisted = await writer.persist({
      provider: "WARCRAFT_LOGS",
      bytes,
      compression: "GZIP",
      artifactClass: "wcl_event_page",
    });

    const payloadRow = await prisma.rawArtifactPayload.findUnique({
      where: { contentHash: persisted.write.contentHash },
    });
    expect(payloadRow).not.toBeNull();
    expect(Buffer.from(payloadRow!.payload).byteLength).toBeGreaterThan(0);

    const reader = freshRepository();
    const read = await reader.readVerified(persisted.artifactId);
    expect(JSON.parse(read.toString("utf8"))).toEqual(envelope);

    const fsEntries = await readdir(emptyFsRoot);
    expect(fsEntries.length).toBe(0);
  });

  it("deduplicates writes by content hash", async () => {
    const bytes = Buffer.from(JSON.stringify({ dataset: "Deaths", events: [] }));
    const a = freshRepository();
    const first = await a.persist({
      provider: "WARCRAFT_LOGS",
      bytes,
      compression: "GZIP",
      artifactClass: "wcl_event_page",
    });
    const second = await a.persist({
      provider: "WARCRAFT_LOGS",
      bytes,
      compression: "GZIP",
      artifactClass: "wcl_event_page",
    });
    expect(second.write.deduplicated).toBe(true);
    expect(second.artifactId).toBe(first.artifactId);
    const count = await prisma.rawArtifactPayload.count({
      where: { contentHash: first.write.contentHash },
    });
    expect(count).toBe(1);
  });

  it("treats zero-event pages as valid distinct from missing payload", async () => {
    const bytes = Buffer.from(JSON.stringify({ events: [], eventCount: 0 }), "utf8");
    const repo = freshRepository();
    const persisted = await repo.persist({
      provider: "WARCRAFT_LOGS",
      bytes,
      compression: "GZIP",
      artifactClass: "wcl_event_page",
    });
    const read = await repo.readVerified(persisted.artifactId);
    expect(JSON.parse(read.toString("utf8")).events).toEqual([]);
    expect(await repo.verifyPayloadReadability(persisted.artifactId)).toBe(
      "DB_PAYLOAD_READABLE",
    );
    expect(await repo.verifyPayloadReadability(randomUUID())).toBe("PAYLOAD_MISSING");
  });

  it("fails digest validation when payload bytes are corrupted", async () => {
    const bytes = Buffer.from(JSON.stringify({ events: [{ type: "death" }] }), "utf8");
    const repo = freshRepository();
    const persisted = await repo.persist({
      provider: "WARCRAFT_LOGS",
      bytes,
      compression: "GZIP",
      artifactClass: "wcl_event_page",
    });
    await prisma.rawArtifactPayload.update({
      where: { contentHash: persisted.write.contentHash },
      data: { payload: Buffer.from("corrupted-bytes") },
    });
    await expect(repo.readVerified(persisted.artifactId)).rejects.toThrow();
    const readability = await repo.verifyPayloadReadability(persisted.artifactId);
    expect(["DIGEST_MISMATCH", "PAYLOAD_MISSING"]).toContain(readability);
  });

  it("reports legacy cas:// rows without PostgreSQL payload as LEGACY_EXTERNAL_ONLY", async () => {
    const contentHash = createHash("sha256")
      .update(JSON.stringify({ legacy: true }))
      .digest("hex");
    const legacy = await prisma.rawArtifact.create({
      data: {
        provider: "WARCRAFT_LOGS",
        storageUri: `cas://sha256/${contentHash}.bin.gz`,
        compression: "GZIP",
        contentHash,
        sizeBytes: BigInt(128),
        uncompressedSizeBytes: BigInt(256),
        artifactClass: "wcl_event_page",
      },
    });
    const repo = createArtifactRepository(prisma);
    await expect(repo.readVerified(legacy.id)).rejects.toThrow(
      ArtifactLegacyExternalPayloadMissingError,
    );
    expect(await repo.verifyPayloadReadability(legacy.id)).toBe("LEGACY_EXTERNAL_ONLY");
  });

  it("can still read legacy cas:// bytes when filesystem store is configured", async () => {
    const fsRoot = await mkdtemp(path.join(tmpdir(), "mplus-pg-art-legacy-"));
    const bytes = Buffer.from(JSON.stringify({ legacyFs: true }), "utf8");
    const fsStore = createLocalFsArtifactStore(fsRoot);
    const write = await fsStore.write({ bytes, compression: "GZIP" });

    const legacy = await prisma.rawArtifact.create({
      data: {
        provider: "WARCRAFT_LOGS",
        storageUri: write.storageUri,
        compression: write.compression,
        contentHash: write.contentHash,
        sizeBytes: BigInt(write.sizeBytes),
        uncompressedSizeBytes: BigInt(write.uncompressedSizeBytes),
        artifactClass: "wcl_event_page",
      },
    });

    const repo = createArtifactRepository(prisma, { legacyFsStore: fsStore });
    const read = await repo.readVerified(legacy.id);
    expect(read.equals(bytes)).toBe(true);
    expect(await repo.verifyPayloadReadability(legacy.id)).toBe("LEGACY_EXTERNAL_ONLY");
  });

  it("stores ranking parse and master data descriptor artifacts in PostgreSQL", async () => {
    const repo = freshRepository();
    const rankingBytes = Buffer.from(
      JSON.stringify({
        reportCode: "AbCdEfGhIjKl",
        fightId: 3,
        reportRevision: 1,
        dungeonSlug: "ara-kara",
        keyLevel: 12,
        bracketPercent: 72,
      }),
      "utf8",
    );
    const ranking = await repo.persist({
      provider: "WARCRAFT_LOGS",
      bytes: rankingBytes,
      compression: "GZIP",
      artifactClass: "wcl-ranking-parse-v2",
    });
    const masterBytes = Buffer.from(JSON.stringify({ actors: [{ id: 10 }] }), "utf8");
    const master = await repo.persist({
      provider: "WARCRAFT_LOGS",
      bytes: masterBytes,
      compression: "GZIP",
      artifactClass: "wcl_master_data",
    });

    expect((await repo.readVerified(ranking.artifactId)).equals(rankingBytes)).toBe(true);
    expect((await repo.readVerified(master.artifactId)).equals(masterBytes)).toBe(true);
    expect(await prisma.rawArtifactPayload.count()).toBeGreaterThanOrEqual(2);
  });

  it("does not create filesystem artifacts for PostgreSQL-backed writes", async () => {
    const isolatedRoot = await mkdtemp(path.join(tmpdir(), "mplus-pg-art-isolated-"));
    const repo = createArtifactRepository(prisma, {
      legacyFsStore: createLocalFsArtifactStore(isolatedRoot),
    });
    await repo.persist({
      provider: "WARCRAFT_LOGS",
      bytes: Buffer.from(JSON.stringify({ probe: randomUUID() })),
      compression: "GZIP",
      artifactClass: "wcl_event_page",
    });
    const entries = await readdir(isolatedRoot, { recursive: true });
    expect(entries.length).toBe(0);
  });

  it("resolves storageUri metadata for artifact ids via getStorageUris", async () => {
    const repo = freshRepository();
    const first = await repo.persist({
      provider: "WARCRAFT_LOGS",
      bytes: Buffer.from(JSON.stringify({ a: 1, id: randomUUID() })),
      compression: "GZIP",
      artifactClass: "wcl_event_page",
    });
    const second = await repo.persist({
      provider: "WARCRAFT_LOGS",
      bytes: Buffer.from(JSON.stringify({ a: 2, id: randomUUID() })),
      compression: "GZIP",
      artifactClass: "wcl_event_page",
    });
    const uris = await repo.getStorageUris([first.artifactId, second.artifactId]);
    expect(uris.size).toBe(2);
    expect(uris.get(first.artifactId)?.startsWith("pg://")).toBe(true);
    expect(uris.get(second.artifactId)?.startsWith("pg://")).toBe(true);
    const missing = await repo.getStorageUris([randomUUID()]);
    expect(missing.size).toBe(0);
  });
});
