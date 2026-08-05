/**
 * PostgreSQL-backed shared evidence reload (no filesystem CAS).
 */
import { createHash, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildEvidenceDatasetScopeFingerprint } from "@mplus/contracts";
import {
  ArtifactLegacyExternalPayloadMissingError,
  checkDatabaseHealth,
  createArtifactRepository,
  createPrismaClient,
  WclSourceRepository,
  type PrismaClient,
} from "@mplus/database";
import {
  WCL_RUN_EVIDENCE_PROVIDER_CONTRACT,
  type WclRunEvidenceDataset,
} from "@mplus/provider-warcraftlogs";
import { assertTestDatabaseAllowed, sanitizeDatabaseUrl } from "@mplus/test-utils";
import { createRepositories } from "../../persistence/index.js";
import {
  createPersistentSharedEvidenceStore,
  selectPreferredEvidencePages,
} from "./persistent-shared-evidence-store.js";

const databaseUrl = process.env.DATABASE_URL ?? "";
assertTestDatabaseAllowed(databaseUrl);

const prisma: PrismaClient = createPrismaClient(databaseUrl);
const health = await checkDatabaseHealth(prisma);
const dbAvailable = health.ok;

if (!dbAvailable) {
  console.warn(
    `Skipping postgres shared-evidence integration: PostgreSQL not reachable at ${sanitizeDatabaseUrl(databaseUrl)}.`,
  );
}

afterAll(async () => {
  await prisma.$disconnect();
});

function dataset(events: Array<Record<string, unknown>>): WclRunEvidenceDataset {
  return {
    key: "Deaths",
    state: "PERSISTED",
    truncated: false,
    pageCount: 1,
    eventCount: events.length,
    filterSourceId: 10,
    filterExpression: null,
    pages: [
      {
        pageIndex: 0,
        startTime: null,
        nextPageTimestamp: null,
        eventCount: events.length,
        payloadFingerprint: createHash("sha256")
          .update(JSON.stringify(events))
          .digest("hex"),
      },
    ],
    events,
    consumers: ["survival", "utility"],
    pointsConsumed: 1,
    costSource: "measured",
    requestCostUnits: [],
    wclRequests: 1,
    fetchedAt: new Date("2026-08-01T00:00:00.000Z").toISOString(),
    source: "provider",
  };
}

describe.runIf(dbAvailable)("postgres shared evidence reload", () => {
  const reportCode = `Pg${randomUUID().replace(/-/g, "").slice(0, 10)}`;
  const fightId = 42;
  const reportRevision = 1;

  it("reloads persisted pages from PostgreSQL without filesystem CAS", async () => {
    const artifacts = createArtifactRepository(prisma);
    const wclSource = new WclSourceRepository(prisma);
    const store = createPersistentSharedEvidenceStore({ wclSource, artifacts });

    const deaths = [{ type: "death", targetID: 10, timestamp: 1000 }];
    const compatibilityKey = `wcl-evidence|${reportCode}|r${reportRevision}|f${fightId}|a10|Deaths|t0-end|fe:none|${WCL_RUN_EVIDENCE_PROVIDER_CONTRACT}|nopayload`;

    await store.saveDataset(compatibilityKey, dataset(deaths), {
      reportCode,
      reportRevision,
      fightId,
      dataset: "Deaths",
    });

    const reloadedArtifacts = createArtifactRepository(prisma);
    const reloadedStore = createPersistentSharedEvidenceStore({
      wclSource: new WclSourceRepository(prisma),
      artifacts: reloadedArtifacts,
    });
    const loaded = await reloadedStore.loadDataset(compatibilityKey);
    expect(loaded).not.toBeNull();
    expect(loaded!.events).toEqual(deaths);
    expect(loaded!.source).toBe("persisted");

    const pageRows = await prisma.evidenceDatasetPage.findMany({
      where: { reportCode, fightId, reportRevision, datasetKey: "Deaths" },
    });
    expect(pageRows.length).toBeGreaterThan(0);
    const bytes = await reloadedArtifacts.readVerified(pageRows[0]!.artifactId);
    const envelope = JSON.parse(bytes.toString("utf8")) as { events: unknown[] };
    expect(envelope.events).toEqual(deaths);
  });
});

describe.runIf(dbAvailable)("createRepositories artifact storageUri contract", () => {
  it("exposes getStorageUris on the production Postgres artifact adapter", async () => {
    const repos = createRepositories(prisma);
    expect(typeof repos.artifacts.getStorageUris).toBe("function");

    const pgBytes = Buffer.from(JSON.stringify({ probe: "pg-prefer" }), "utf8");
    const persisted = await repos.artifacts.persist({
      provider: "WARCRAFT_LOGS",
      bytes: pgBytes,
      compression: "GZIP",
      artifactClass: "wcl_event_page",
    });

    const uris = await repos.artifacts.getStorageUris([persisted.artifactId]);
    expect(uris.get(persisted.artifactId)?.startsWith("pg://")).toBe(true);
  });

  it("prefers pg:// over stale cas:// using persisted RawArtifact metadata", async () => {
    const repos = createRepositories(prisma);
    const reportCode = `Rt${randomUUID().replace(/-/g, "").slice(0, 10)}`;
    const fightId = 7;
    const reportRevision = 3;
    const scopeFingerprint = buildEvidenceDatasetScopeFingerprint({
      datasetKey: "Casts",
      sourceActorId: 10,
      filterExpression: null,
      hostilityType: null,
      includeResources: false,
      startTime: null,
      endTime: null,
      providerContractVersion: WCL_RUN_EVIDENCE_PROVIDER_CONTRACT,
    });

    const events = [{ type: "cast", abilityGameID: 111898 }];
    const envelope = {
      schemaVersion: "wcl-event-page-v1",
      providerContractVersion: WCL_RUN_EVIDENCE_PROVIDER_CONTRACT,
      reportCode,
      fightId,
      reportRevision,
      datasetKey: "Casts",
      pageIndex: 0,
      pageCursor: null,
      nextPageCursor: null,
      filterExpression: null,
      filterSourceId: 10,
      scopeFingerprint,
      truncated: false,
      events,
    };
    const bytes = Buffer.from(JSON.stringify(envelope), "utf8");
    const legacyHash = createHash("sha256")
      .update(`legacy:${reportCode}:${fightId}`)
      .digest("hex");

    const legacy = await prisma.rawArtifact.create({
      data: {
        provider: "WARCRAFT_LOGS",
        storageUri: `cas://sha256/${legacyHash}.bin.gz`,
        compression: "GZIP",
        contentHash: legacyHash,
        sizeBytes: BigInt(64),
        uncompressedSizeBytes: BigInt(128),
        artifactClass: "wcl_event_page",
      },
    });
    const pgPersist = await repos.artifacts.persist({
      provider: "WARCRAFT_LOGS",
      bytes,
      compression: "GZIP",
      artifactClass: "wcl_event_page",
    });

    const storageUris = await repos.artifacts.getStorageUris([
      legacy.id,
      pgPersist.artifactId,
    ]);
    expect(storageUris.get(legacy.id)?.startsWith("cas://")).toBe(true);
    expect(storageUris.get(pgPersist.artifactId)?.startsWith("pg://")).toBe(true);

    const preferred = selectPreferredEvidencePages(
      [
        { pageIndex: 0, artifactId: legacy.id, eventCount: 1 },
        { pageIndex: 0, artifactId: pgPersist.artifactId, eventCount: 1 },
      ],
      storageUris,
    );
    expect(preferred).toHaveLength(1);
    expect(preferred[0]?.artifactId).toBe(pgPersist.artifactId);
  });

  it("treats legacy-only evidence as a live cache miss and fails closed otherwise", async () => {
    const repos = createRepositories(prisma);
    const reportCode = `Lg${randomUUID().replace(/-/g, "").slice(0, 10)}`;
    const fightId = 9;
    const reportRevision = 2;
    const scopeFingerprint = buildEvidenceDatasetScopeFingerprint({
      datasetKey: "Casts",
      sourceActorId: 10,
      filterExpression: null,
      hostilityType: null,
      includeResources: false,
      startTime: null,
      endTime: null,
      providerContractVersion: WCL_RUN_EVIDENCE_PROVIDER_CONTRACT,
    });
    const contentHash = createHash("sha256")
      .update(`${reportCode}:${fightId}:legacy`)
      .digest("hex");
    const legacy = await prisma.rawArtifact.create({
      data: {
        provider: "WARCRAFT_LOGS",
        storageUri: `cas://sha256/${contentHash}.bin.gz`,
        compression: "GZIP",
        contentHash,
        sizeBytes: BigInt(32),
        uncompressedSizeBytes: BigInt(64),
        artifactClass: "wcl_event_page",
      },
    });
    await prisma.evidenceDatasetPage.create({
      data: {
        reportCode,
        fightId,
        reportRevision,
        datasetKey: "Casts",
        pageIndex: 0,
        pageCursor: null,
        artifactId: legacy.id,
        contentHash,
        providerContractVersion: WCL_RUN_EVIDENCE_PROVIDER_CONTRACT,
        schemaVersion: "wcl-event-page-v1",
        scopeFingerprint,
        eventCount: 1,
      },
    });

    const compatibilityKey = `wcl-evidence|${reportCode}|r${reportRevision}|f${fightId}|a10|Casts|t0-end|fe:none|${WCL_RUN_EVIDENCE_PROVIDER_CONTRACT}|nopayload`;

    const liveStore = createPersistentSharedEvidenceStore({
      wclSource: repos.wclSource,
      artifacts: repos.artifacts,
      treatLegacyPayloadMissingAsCacheMiss: true,
    });
    await expect(liveStore.loadDataset(compatibilityKey)).resolves.toBeNull();

    const providerFreeStore = createPersistentSharedEvidenceStore({
      wclSource: new WclSourceRepository(prisma),
      artifacts: createRepositories(prisma).artifacts,
    });
    await expect(providerFreeStore.loadDataset(compatibilityKey)).rejects.toThrow(
      ArtifactLegacyExternalPayloadMissingError,
    );
  });
});
