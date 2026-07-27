import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
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

  it("runs a second manual refresh after COMPLETED (same dedupe, cooldown cleared)", async () => {
    const name = uniqueName("SecondRefresh");
    const path = `/api/v1/characters/${REALM_PATH}/${name}/refresh`;

    const first = await app.inject({ method: "POST", url: path });
    expect(first.statusCode).toBe(200);
    expect(first.json().job?.status).toBe("completed");
    const firstJobId = first.json().job?.jobId as string;
    const firstFinishedAt = first.json().job?.finishedAt as string | null;

    // Clear cooldown without forceRefresh so the same logical dedupe key is reused
    // (the live regression: terminal BullMQ jobId === dedupeKey blocked requeue).
    await prisma.character.updateMany({
      where: { normalizedName: normalizeName(name) },
      data: { lastPublicRefreshAt: null },
    });

    const second = await app.inject({ method: "POST", url: path });
    expect(second.statusCode).toBe(200);
    expect(second.json().job?.status).toBe("completed");
    expect(second.json().job?.jobId).toBe(firstJobId);
    expect(second.json().cooldownSecondsRemaining).toBe(0);
    // New terminal execution — finishedAt must advance (worker ran again).
    expect(second.json().job?.finishedAt).toBeTruthy();
    expect(second.json().job?.finishedAt).not.toBe(firstFinishedAt);
    expect(second.json().job?.errorMessage).toBeNull();
  });

  it("collapses concurrent in-flight refresh requests onto one job", async () => {
    const name = uniqueName("ConcurrentRefresh");
    // Seed a QUEUED job without completing so the second call hits the active-job short-circuit.
    const character = await container.worker.repositories.character.upsertCharacter(
      { region: "EU", realmSlug: "tarren-mill", name },
      { displayName: name },
    );
    const dedupeKey = `concurrent-${randomUUID()}`;
    const queued = await container.worker.repositories.job.createOrGetByDedupe({
      jobType: "refresh-character",
      dedupeKey,
      characterId: character.id,
      payload: { region: "EU", realmSlug: "tarren-mill", name },
    });
    expect(queued.job.status).toBe("QUEUED");

    const [a, b] = await Promise.all([
      app.inject({ method: "POST", url: `/api/v1/characters/${REALM_PATH}/${name}/refresh` }),
      app.inject({ method: "POST", url: `/api/v1/characters/${REALM_PATH}/${name}/refresh` }),
    ]);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(a.json().job?.jobId).toBe(queued.job.id);
    expect(b.json().job?.jobId).toBe(queued.job.id);
    expect(["queued", "QUEUED", "in_progress", "IN_PROGRESS"]).toContain(
      String(a.json().job?.status).toLowerCase(),
    );
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
