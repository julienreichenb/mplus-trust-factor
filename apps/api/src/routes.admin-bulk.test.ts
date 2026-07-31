import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@mplus/database";
import type { QueueProducers } from "@mplus/worker";
import { buildApp } from "./app.js";
import { createApiContainer, type ApiContainer } from "./container.js";
import { buildTestEnv, createTestPrismaClient } from "./test-helpers.js";

const { prisma, dbAvailable } = await createTestPrismaClient();
const ADMIN_KEY = "test-admin-key";

afterAll(async () => {
  await prisma.$disconnect();
});

/** Avoid inline selection of the full character table — these tests assert API/persistence contracts. */
function stubProducers(): QueueProducers {
  const ok = async () => ({
    jobId: randomUUID(),
    dedupeKey: `stub-${randomUUID()}`,
    reused: false,
    enqueued: true,
  });
  return {
    enqueueRefreshCharacter: ok,
    enqueueAnalyzeRun: ok,
    enqueueRecalculateScore: ok,
    enqueueGenerateAddonExport: ok,
    enqueueDiscoverOwnedCharacters: ok,
    enqueueBulkCharacterProcessing: ok,
    close: async () => undefined,
  } as QueueProducers;
}

describe.skipIf(!dbAvailable)("admin bulk-operations routes", () => {
  let app: FastifyInstance;
  let container: ApiContainer;

  beforeAll(async () => {
    const env = buildTestEnv({ ADMIN_API_KEY: ADMIN_KEY });
    container = createApiContainer(env, {
      workerOverrides: { prisma: prisma as PrismaClient },
      producers: stubProducers(),
    });
    app = await buildApp({ env, container });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects unauthenticated bulk operation listing", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/admin/bulk-operations" });
    expect(response.statusCode).toBe(401);
  });

  it("creates a dry-run bulk operation and rejects duplicate active logical keys", async () => {
    const logicalKey = `test-bulk-${Date.now()}`;
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/v1/admin/bulk-operations",
      headers: { "x-admin-api-key": ADMIN_KEY },
      payload: {
        mode: "RECALCULATE_ONLY",
        minMythicPlusScore: null,
        batchSize: 10,
        dryRun: true,
        logicalKey,
      },
    });
    expect(createResponse.statusCode).toBe(201);
    const created = createResponse.json();
    expect(created.dryRun).toBe(true);
    expect(created.completionSemantics).toBe("CHILD_DISPATCH_FINISHED");
    expect(created.childOutcomesTracked).toBe(false);
    expect(created.progress).toEqual(
      expect.objectContaining({
        dispatchedCount: expect.any(Number),
        enqueuedCount: expect.any(Number),
        dispatchFailedCount: expect.any(Number),
        skippedCount: expect.any(Number),
        selectedCount: expect.any(Number),
      }),
    );
    expect(created.progress.completedCount).toBeUndefined();
    expect(created.progress.failedCount).toBeUndefined();
    // Stubbed producers skip the orchestrator tick — row stays PENDING until a worker runs.
    expect(["DRY_RUN_COMPLETED", "PENDING", "SELECTING", "RUNNING"]).toContain(created.status);

    const getResponse = await app.inject({
      method: "GET",
      url: `/api/v1/admin/bulk-operations/${created.id}`,
      headers: { "x-admin-api-key": ADMIN_KEY },
    });
    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.json().id).toBe(created.id);

    await prisma.bulkOperation.update({
      where: { id: created.id },
      data: { status: "RUNNING", completedAt: null },
    });

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/v1/admin/bulk-operations",
      headers: { "x-admin-api-key": ADMIN_KEY },
      payload: {
        mode: "RECALCULATE_ONLY",
        minMythicPlusScore: null,
        batchSize: 10,
        dryRun: true,
        logicalKey,
      },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe("BULK_OPERATION_ACTIVE");
  });

  it("supports pause and cancel semantics", async () => {
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/v1/admin/bulk-operations",
      headers: { "x-admin-api-key": ADMIN_KEY },
      payload: {
        mode: "FULL_REFRESH",
        minMythicPlusScore: 99999,
        batchSize: 5,
        dryRun: false,
        maxWclCalls: 1,
        logicalKey: `pause-cancel-${Date.now()}`,
      },
    });
    expect(createResponse.statusCode).toBe(201);
    const created = createResponse.json();

    await prisma.bulkOperation.update({
      where: { id: created.id },
      data: { status: "RUNNING", completedAt: null },
    });

    const pauseResponse = await app.inject({
      method: "POST",
      url: `/api/v1/admin/bulk-operations/${created.id}/pause`,
      headers: { "x-admin-api-key": ADMIN_KEY },
    });
    expect(pauseResponse.statusCode).toBe(200);
    expect(pauseResponse.json().pauseRequestedAt).toBeTruthy();

    const cancelResponse = await app.inject({
      method: "POST",
      url: `/api/v1/admin/bulk-operations/${created.id}/cancel`,
      headers: { "x-admin-api-key": ADMIN_KEY },
    });
    expect(cancelResponse.statusCode).toBe(200);
    expect(cancelResponse.json().cancelRequestedAt).toBeTruthy();
  });

  it("rejects unauthenticated admin character search", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/admin/characters/search?query=ale",
    });
    expect(response.statusCode).toBe(401);
  });

  it("rejects ambiguous explicit + cohort payloads and missing character ids", async () => {
    const ambiguous = await app.inject({
      method: "POST",
      url: "/api/v1/admin/bulk-operations",
      headers: { "x-admin-api-key": ADMIN_KEY },
      payload: {
        mode: "RECALCULATE_ONLY",
        minMythicPlusScore: 1000,
        characterIds: ["11111111-1111-4111-8111-111111111111"],
        dryRun: true,
      },
    });
    expect(ambiguous.statusCode).toBe(400);

    const missing = await app.inject({
      method: "POST",
      url: "/api/v1/admin/bulk-operations",
      headers: { "x-admin-api-key": ADMIN_KEY },
      payload: {
        mode: "RECALCULATE_ONLY",
        minMythicPlusScore: null,
        characterIds: ["11111111-1111-4111-8111-111111111111"],
        dryRun: true,
        logicalKey: `missing-chars-${Date.now()}`,
      },
    });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error.code).toBe("BULK_CHARACTERS_NOT_FOUND");
  });

  it("creates an explicit-selection dry-run with selectionMode EXPLICIT", async () => {
    const region =
      (await prisma.region.findFirst()) ??
      (await prisma.region.create({ data: { code: "EU", name: "Europe" } }));
    const realm =
      (await prisma.realm.findFirst({ where: { regionId: region.id } })) ??
      (await prisma.realm.create({
        data: { regionId: region.id, slug: `bulk-ux-${Date.now()}`, name: "Bulk UX" },
      }));
    const character = await prisma.character.create({
      data: {
        regionId: region.id,
        realmId: realm.id,
        normalizedName: `bulkux${Date.now()}`,
        displayName: `BulkUx${Date.now()}`,
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/bulk-operations",
      headers: { "x-admin-api-key": ADMIN_KEY },
      payload: {
        mode: "RECALCULATE_ONLY",
        minMythicPlusScore: null,
        characterIds: [character.id, character.id],
        dryRun: true,
        logicalKey: `explicit-${Date.now()}`,
      },
    });
    expect(response.statusCode).toBe(201);
    const created = response.json();
    expect(created.selectionMode).toBe("EXPLICIT");
    // Custom logicalKey is preserved when provided; default fingerprint path is covered by unit tests.
    expect(created.logicalKey.startsWith("explicit-")).toBe(true);
    const snapshot = await prisma.bulkOperation.findUnique({ where: { id: created.id } });
    expect(snapshot?.configSnapshot).toEqual(
      expect.objectContaining({ characterIds: [character.id] }),
    );
  });

  it("translates concurrent create races into BULK_OPERATION_ACTIVE", async () => {
    const logicalKey = `race-bulk-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const payload = {
      mode: "RECALCULATE_ONLY" as const,
      minMythicPlusScore: null,
      batchSize: 10,
      dryRun: false,
      logicalKey,
    };
    const [a, b] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/api/v1/admin/bulk-operations",
        headers: { "x-admin-api-key": ADMIN_KEY },
        payload,
      }),
      app.inject({
        method: "POST",
        url: "/api/v1/admin/bulk-operations",
        headers: { "x-admin-api-key": ADMIN_KEY },
        payload,
      }),
    ]);
    const statuses = [a.statusCode, b.statusCode].sort();
    expect(statuses).toEqual([201, 409]);
    const conflict = a.statusCode === 409 ? a : b;
    expect(conflict.json().error.code).toBe("BULK_OPERATION_ACTIVE");

    const created = await prisma.bulkOperation.findMany({ where: { logicalKey } });
    expect(created).toHaveLength(1);
    expect(["PENDING", "SELECTING", "RUNNING", "PAUSED"]).toContain(created[0]!.status);
  });
});
