import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { normalizeName } from "@mplus/domain";
import type { PrismaClient } from "@mplus/database";
import { buildApp } from "./app.js";
import { createApiContainer, type ApiContainer } from "./container.js";
import { buildTestEnv, createTestPrismaClient, uniqueName } from "./test-helpers.js";

const { prisma, dbAvailable } = await createTestPrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

describe.skipIf(!dbAvailable)("character routes", () => {
  let app: FastifyInstance;
  let container: ApiContainer;

  beforeAll(async () => {
    const env = buildTestEnv();
    // `skipQueues: true` runs the refresh pipeline inline (no Redis/BullMQ worker required) so
    // `inject()` tests can observe a persisted score synchronously.
    container = createApiContainer(env, { workerOverrides: { prisma: prisma as PrismaClient }, skipQueues: true });
    app = await buildApp({ env, container });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const REALM_PATH = "EU/tarren-mill";

  it("returns 202 QUEUED for a never-seen character, then 200 FRESH on the next request", async () => {
    const name = uniqueName("Freshcharacter");

    const first = await app.inject({ method: "GET", url: `/api/v1/characters/${REALM_PATH}/${name}` });
    expect(first.statusCode).toBe(202);
    const firstBody = first.json();
    expect(firstBody.refreshStatus).toBe("QUEUED");
    expect(firstBody.score).toBeNull();

    const second = await app.inject({ method: "GET", url: `/api/v1/characters/${REALM_PATH}/${name}` });
    expect(second.statusCode).toBe(200);
    const secondBody = second.json();
    expect(secondBody.refreshStatus).toBe("FRESH");
    expect(secondBody.score).not.toBeNull();
    expect(secondBody.score.overallScore).toBeGreaterThanOrEqual(0);
    expect(secondBody.score.overallScore).toBeLessThanOrEqual(100);

    // No secrets, tokens, or raw provider payloads should ever leak through the API.
    const raw = JSON.stringify(secondBody);
    expect(raw).not.toMatch(/clientSecret|client_secret|admin_api_key|session_secret/i);
  });

  it("marks a score STALE once past the freshness TTL and re-enqueues a refresh", async () => {
    const name = uniqueName("Stalecharacter");

    await app.inject({ method: "GET", url: `/api/v1/characters/${REALM_PATH}/${name}` });
    await app.inject({ method: "GET", url: `/api/v1/characters/${REALM_PATH}/${name}` });

    const character = await prisma.character.findFirst({ where: { normalizedName: normalizeName(name) } });
    expect(character).not.toBeNull();
    await prisma.character.update({
      where: { id: character!.id },
      data: { lastPublicRefreshAt: new Date(Date.now() - 999_999_999_999) },
    });
    container.responseCache.clear();

    const response = await app.inject({ method: "GET", url: `/api/v1/characters/${REALM_PATH}/${name}` });
    expect(response.statusCode).toBe(200);
    expect(response.json().refreshStatus).toBe("STALE");
  });

  it("returns 404 for a confirmed not-found identity on the second request", async () => {
    const name = uniqueName("MissingCharacter");

    const first = await app.inject({ method: "GET", url: `/api/v1/characters/${REALM_PATH}/${name}` });
    expect(first.statusCode).toBe(202);

    const second = await app.inject({ method: "GET", url: `/api/v1/characters/${REALM_PATH}/${name}` });
    expect(second.statusCode).toBe(404);
    expect(second.json().error.code).toBe("CHARACTER_NOT_FOUND");
    expect(second.json().error.requestId).toBeTruthy();
  });

  it("enforces the manual refresh cooldown on repeated POST /refresh calls", async () => {
    const name = uniqueName("Cooldowncharacter");

    const first = await app.inject({ method: "POST", url: `/api/v1/characters/${REALM_PATH}/${name}/refresh` });
    expect(first.statusCode).toBe(200);
    expect(first.json().cooldownSecondsRemaining).toBe(0);

    const second = await app.inject({ method: "POST", url: `/api/v1/characters/${REALM_PATH}/${name}/refresh` });
    expect(second.statusCode).toBe(200);
    expect(second.json().cooldownSecondsRemaining).toBeGreaterThan(0);
  });

  it("exposes job status via GET /jobs/:id after a refresh completes", async () => {
    const name = uniqueName("JobLookupCharacter");

    const refreshResponse = await app.inject({ method: "POST", url: `/api/v1/characters/${REALM_PATH}/${name}/refresh` });
    const jobId = refreshResponse.json().job?.jobId as string | undefined;
    expect(jobId).toBeTruthy();

    const jobResponse = await app.inject({ method: "GET", url: `/api/v1/jobs/${jobId}` });
    expect(jobResponse.statusCode).toBe(200);
    expect(jobResponse.json().status).toBe("completed");
  });

  it("refresh-status reaches a terminal FRESH state after successful inline refresh", async () => {
    const name = uniqueName("RefreshPollTerminal");

    await app.inject({ method: "GET", url: `/api/v1/characters/${REALM_PATH}/${name}` });

    const status = await app.inject({
      method: "GET",
      url: `/api/v1/characters/${REALM_PATH}/${name}/refresh-status`,
    });
    expect(status.statusCode).toBe(200);
    const body = status.json();
    expect(["FRESH", "STALE"]).toContain(body.refreshStatus);
    expect(body.job?.status).toBe("completed");
    expect(body.job?.errorMessage).toBeNull();
  });

  it("returns 404 for an unknown job id", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/jobs/00000000-0000-0000-0000-000000000000" });
    expect(response.statusCode).toBe(404);
  });
});
