import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@mplus/database";
import { ensureCurrentSeason, ensureDungeon } from "@mplus/worker";
import { buildApp } from "./app.js";
import { createApiContainer, type ApiContainer } from "./container.js";
import { buildScoreModelConfig, buildTestEnv, createTestPrismaClient, uniqueName } from "./test-helpers.js";

const { prisma, dbAvailable } = await createTestPrismaClient();
const ADMIN_KEY = "test-admin-key";

afterAll(async () => {
  await prisma.$disconnect();
});

describe.skipIf(!dbAvailable)("admin routes", { timeout: 30_000 }, () => {
  let app: FastifyInstance;
  let container: ApiContainer;

  beforeAll(async () => {
    const env = buildTestEnv({ ADMIN_API_KEY: ADMIN_KEY });
    container = createApiContainer(env, {
      workerOverrides: { prisma: prisma as PrismaClient },
      skipQueues: true,
    });
    // Activation enqueues RECALCULATE_ONLY for all characters; do not run that cohort
    // inline during this suite (avoids post-teardown Prisma races).
    container.producers.enqueueBulkCharacterProcessing = async () => ({
      jobId: randomUUID(),
      dedupeKey: `stub-bulk-${randomUUID()}`,
      reused: false,
      enqueued: true,
    });
    app = await buildApp({ env, container });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects requests without an admin API key", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/admin/score-models" });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("UNAUTHORIZED");
  });

  it("rejects requests with an incorrect admin API key", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/admin/score-models",
      headers: { "x-admin-api-key": "not-the-right-key" },
    });
    expect(response.statusCode).toBe(401);
  });

  it("creates, validates, and activates a score model with a valid admin key", async () => {
    const key = `admin-test-${randomUUID().slice(0, 8)}`;

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/v1/admin/score-models",
      headers: { "x-admin-api-key": ADMIN_KEY },
      payload: { key, name: "Admin Test Model", config: buildScoreModelConfig(key) },
    });
    expect(createResponse.statusCode).toBe(201);
    const model = createResponse.json();
    expect(model.status).toBe("DRAFT");

    const listResponse = await app.inject({
      method: "GET",
      url: "/api/v1/admin/score-models",
      headers: { "x-admin-api-key": ADMIN_KEY },
    });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json().models.some((m: { id: string }) => m.id === model.id)).toBe(true);

    const validateResponse = await app.inject({
      method: "POST",
      url: `/api/v1/admin/score-models/${model.id}/validate`,
      headers: { "x-admin-api-key": ADMIN_KEY },
    });
    expect(validateResponse.statusCode).toBe(200);
    expect(validateResponse.json().valid).toBe(true);

    const backtestResponse = await app.inject({
      method: "POST",
      url: `/api/v1/admin/score-models/${model.id}/backtest`,
      headers: { "x-admin-api-key": ADMIN_KEY },
      payload: {},
    });
    expect(backtestResponse.statusCode).toBe(200);
    expect(backtestResponse.json().scoreModelId).toBe(model.id);

    const activateResponse = await app.inject({
      method: "POST",
      url: `/api/v1/admin/score-models/${model.id}/activate`,
      headers: { "x-admin-api-key": ADMIN_KEY },
      payload: { confirm: true },
    });
    expect(activateResponse.statusCode).toBe(200);
    expect(activateResponse.json().status).toBe("ACTIVE");
    expect(activateResponse.json().bulkOperationId).toBeTruthy();

    const backtestBody = backtestResponse.json();
    expect(backtestBody.source).toBe("persisted-export");
    expect(String(backtestBody.note ?? "")).not.toContain("Fixture placeholder");
  });

  it("manages mechanic rules end-to-end (create, get, patch, deactivate)", async () => {
    const region = await prisma.region.upsert({
      where: { code: "EU" },
      update: {},
      create: { code: "EU", apiHost: "https://eu.api.blizzard.com", localeDefault: "en_GB", enabled: true },
    });
    const season = await ensureCurrentSeason(prisma, region.id);
    const dungeon = await ensureDungeon(prisma, `admin-test-dungeon-${randomUUID().slice(0, 8)}`);

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/v1/admin/mechanic-rules",
      headers: { "x-admin-api-key": ADMIN_KEY },
      payload: {
        seasonId: season.id,
        dungeonId: dungeon.id,
        spellId: 123456,
        ruleType: "PRIORITY_INTERRUPT",
        severity: 5,
        applicableRoles: ["DPS", "TANK"],
        source: "test-fixture",
        version: "v1",
      },
    });
    expect(createResponse.statusCode).toBe(201);
    const rule = createResponse.json();
    expect(rule.active).toBe(true);

    const getResponse = await app.inject({
      method: "GET",
      url: `/api/v1/admin/mechanic-rules/${rule.id}`,
      headers: { "x-admin-api-key": ADMIN_KEY },
    });
    expect(getResponse.statusCode).toBe(200);

    const patchResponse = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/mechanic-rules/${rule.id}`,
      headers: { "x-admin-api-key": ADMIN_KEY },
      payload: { severity: 8 },
    });
    expect(patchResponse.statusCode).toBe(200);
    expect(patchResponse.json().severity).toBe(8);

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/mechanic-rules/${rule.id}`,
      headers: { "x-admin-api-key": ADMIN_KEY },
    });
    expect(deleteResponse.statusCode).toBe(200);
    expect(deleteResponse.json().active).toBe(false);
  });

  it("recalculates a character's score on demand", async () => {
    const name = uniqueName("AdminRecalcTarget");
    const response = await app.inject({ method: "GET", url: `/api/v1/characters/EU/tarren-mill/${name}` });
    expect([200, 202]).toContain(response.statusCode);
    const characterId = response.json().characterId as string;

    const recalcResponse = await app.inject({
      method: "POST",
      url: `/api/v1/admin/characters/${characterId}/recalculate`,
      headers: { "x-admin-api-key": ADMIN_KEY },
    });
    expect(recalcResponse.statusCode).toBe(200);
    expect(recalcResponse.json().status).toBe("completed");
  }, 30_000);
});
