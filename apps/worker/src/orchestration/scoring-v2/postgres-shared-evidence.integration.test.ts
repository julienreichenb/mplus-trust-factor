/**
 * PostgreSQL-backed shared evidence reload (no filesystem CAS).
 */
import { createHash, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { WCL_RUN_EVIDENCE_PROVIDER_CONTRACT, type WclRunEvidenceDataset } from "@mplus/provider-warcraftlogs";
import {
  checkDatabaseHealth,
  createArtifactRepository,
  createPrismaClient,
  WclSourceRepository,
  type PrismaClient,
} from "@mplus/database";
import { assertTestDatabaseAllowed, sanitizeDatabaseUrl } from "@mplus/test-utils";
import { createPersistentSharedEvidenceStore } from "./persistent-shared-evidence-store.js";

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
