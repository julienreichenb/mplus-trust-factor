import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@mplus/database";
import type { QueueProducers } from "@mplus/worker";
import { buildApp } from "./app.js";
import { createApiContainer, type ApiContainer } from "./container.js";
import { buildScoreModelConfig, buildTestEnv, createTestPrismaClient } from "./test-helpers.js";

const { prisma, dbAvailable } = await createTestPrismaClient();
const ADMIN_KEY = "test-admin-key-lifecycle";

afterAll(async () => {
  await prisma.$disconnect();
});

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
    getRefreshCharacterQueue: () => null,
    close: async () => undefined,
  } as QueueProducers;
}

describe.skipIf(!dbAvailable)("admin score model lifecycle (Agent 08)", { timeout: 60_000 }, () => {
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

  function adminHeaders() {
    return { "x-admin-api-key": ADMIN_KEY };
  }

  async function createDraft(key: string) {
    const config = buildScoreModelConfig(key);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/score-models",
      headers: adminHeaders(),
      payload: {
        key,
        name: `Lifecycle ${key}`,
        config,
      },
    });
    expect(response.statusCode).toBe(201);
    return response.json() as { id: string; key: string; version: number; status: string };
  }

  it("denies normal users without admin credentials", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/admin/score-models" });
    expect(response.statusCode).toBe(401);
  });

  it("refuses activating ARCHIVED / already ACTIVE models", async () => {
    const key = `life-arch-${randomUUID().slice(0, 8)}`;
    const draft = await createDraft(key);
    const activate = await app.inject({
      method: "POST",
      url: `/api/v1/admin/score-models/${draft.id}/activate`,
      headers: adminHeaders(),
      payload: { confirm: true },
    });
    expect(activate.statusCode).toBe(200);

    const again = await app.inject({
      method: "POST",
      url: `/api/v1/admin/score-models/${draft.id}/activate`,
      headers: adminHeaders(),
      payload: { confirm: true },
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe("SCORE_MODEL_NOT_ACTIVATABLE");
  });

  it("refuses invalid draft activation and keeps previous ACTIVE", async () => {
    const key = `life-inv-${randomUUID().slice(0, 8)}`;
    const good = await createDraft(key);
    const activateGood = await app.inject({
      method: "POST",
      url: `/api/v1/admin/score-models/${good.id}/activate`,
      headers: adminHeaders(),
      payload: { confirm: true },
    });
    expect(activateGood.statusCode).toBe(200);

    const badConfig = buildScoreModelConfig(key);
    const badCreate = await app.inject({
      method: "POST",
      url: "/api/v1/admin/score-models",
      headers: adminHeaders(),
      payload: {
        key,
        name: "Bad draft",
        config: {
          ...badConfig,
          weights: { ...badConfig.weights, performance: 0.9, survival: 0.9 },
        },
      },
    });
    expect(badCreate.statusCode).toBe(400);

    const stillActive = await prisma.scoreModel.findFirst({
      where: { id: good.id },
    });
    expect(stillActive?.status).toBe("ACTIVE");
  });

  it("archives previous ACTIVE, writes audit, and enqueues RECALCULATE_ONLY once", async () => {
    const key = `life-act-${randomUUID().slice(0, 8)}`;
    const first = await createDraft(key);
    const activateFirst = await app.inject({
      method: "POST",
      url: `/api/v1/admin/score-models/${first.id}/activate`,
      headers: adminHeaders(),
      payload: { confirm: true },
    });
    expect(activateFirst.statusCode).toBe(200);
    expect(activateFirst.json().bulkOperationId).toBeTruthy();

    const second = await createDraft(key);
    const activateSecond = await app.inject({
      method: "POST",
      url: `/api/v1/admin/score-models/${second.id}/activate`,
      headers: adminHeaders(),
      payload: { confirm: true, expectedPreviousActiveId: first.id },
    });
    expect(activateSecond.statusCode).toBe(200);
    const body = activateSecond.json();
    expect(body.status).toBe("ACTIVE");
    expect(body.previousActiveId).toBe(first.id);
    expect(body.bulkOperationId).toBeTruthy();
    expect(body.bulkEnqueueError).toBeNull();

    const archived = await prisma.scoreModel.findUnique({ where: { id: first.id } });
    expect(archived?.status).toBe("ARCHIVED");
    const activeRows = await prisma.scoreModel.findMany({
      where: { key, status: "ACTIVE" },
    });
    expect(activeRows).toHaveLength(1);
    expect(activeRows[0]?.id).toBe(second.id);

    const audits = await prisma.auditEvent.findMany({
      where: { action: "admin.score_models.activate", resourceId: second.id },
    });
    expect(audits.length).toBeGreaterThanOrEqual(1);

    const bulkOps = await prisma.bulkOperation.findMany({
      where: { logicalKey: `model-activate:${second.id}` },
    });
    expect(bulkOps).toHaveLength(1);
    expect(bulkOps[0]?.mode).toBe("RECALCULATE_ONLY");
  });

  it("two concurrent activations leave exactly one ACTIVE", async () => {
    const key = `life-race-${randomUUID().slice(0, 8)}`;
    const a = await createDraft(key);
    const b = await createDraft(key);

    const [r1, r2] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/api/v1/admin/score-models/${a.id}/activate`,
        headers: adminHeaders(),
        payload: { confirm: true },
      }),
      app.inject({
        method: "POST",
        url: `/api/v1/admin/score-models/${b.id}/activate`,
        headers: adminHeaders(),
        payload: { confirm: true },
      }),
    ]);

    const codes = [r1.statusCode, r2.statusCode].sort();
    expect(codes[0]).toBe(200);
    expect([200, 409]).toContain(codes[1]);

    const activeRows = await prisma.scoreModel.findMany({
      where: { key, status: "ACTIVE" },
    });
    expect(activeRows).toHaveLength(1);
  });

  it("backtest is a real persisted export, not the fixture placeholder distribution", async () => {
    const key = `life-bt-${randomUUID().slice(0, 8)}`;
    const draft = await createDraft(key);
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/score-models/${draft.id}/backtest`,
      headers: adminHeaders(),
      payload: {},
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.source).toBe("persisted-export");
    expect(body.modelActivated).toBe(false);
    expect(body.providerCallsMade).toBe(false);
    expect(String(body.note ?? "")).not.toContain("Fixture placeholder");
    if (body.sampleSize === 0) {
      expect(body.meanScore).toBe(0);
    }
  });

  it("restart-style lookup preserves ACTIVE without env key dependence", async () => {
    const key = `life-boot-${randomUUID().slice(0, 8)}`;
    const draft = await createDraft(key);
    await app.inject({
      method: "POST",
      url: `/api/v1/admin/score-models/${draft.id}/activate`,
      headers: adminHeaders(),
      payload: { confirm: true },
    });

    const viaRepo = await container.worker.repositories.score.getActiveModel(key);
    expect(viaRepo?.id).toBe(draft.id);

    const meta = await app.inject({ method: "GET", url: "/api/v1/meta" });
    expect(meta.statusCode).toBe(200);
    const active = meta.json().activeScoreModel as { key: string; version: number };
    expect(typeof active.key).toBe("string");
    expect(typeof active.version).toBe("number");
  });
});
