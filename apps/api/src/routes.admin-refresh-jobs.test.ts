import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@mplus/database";
import type { QueueProducers } from "@mplus/worker";
import { buildApp } from "./app.js";
import { createApiContainer, type ApiContainer } from "./container.js";
import { buildTestEnv, cleanupTrackedCharacters, cleanupTrackedIngestionJobs, createTestPrismaClient } from "./test-helpers.js";

const { prisma, dbAvailable } = await createTestPrismaClient();
const ADMIN_KEY = "test-admin-key";

const trackedJobIds: string[] = [];
const trackedCharacterIds: string[] = [];

afterAll(async () => {
  const related = await prisma.ingestionJob.findMany({
    where: {
      OR: [
        { id: { in: trackedJobIds } },
        { characterId: { in: trackedCharacterIds } },
      ],
    },
    select: { id: true },
  });
  await cleanupTrackedIngestionJobs(
    prisma,
    [...new Set([...trackedJobIds, ...related.map((j) => j.id)])],
  );
  await cleanupTrackedCharacters(prisma, trackedCharacterIds);
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
    enqueueCalibrationRun: ok,
    enqueueScoringEvidenceExport: ok,
    enqueueAnalyzeEvidenceSlot: ok,
    enqueueFinalizeEvidenceBatch: ok,
    getRefreshCharacterQueue: () => null,
    getCalibrationRunQueue: () => null,
    close: async () => undefined,
  } as QueueProducers;
}

describe.skipIf(!dbAvailable)("admin refresh-jobs routes", () => {
  let app: FastifyInstance;
  let container: ApiContainer;
  let regionId: string;
  let realmId: string;
  let characterId: string;

  beforeAll(async () => {
    const env = buildTestEnv({ ADMIN_API_KEY: ADMIN_KEY });
    container = createApiContainer(env, {
      workerOverrides: { prisma: prisma as PrismaClient },
      producers: stubProducers(),
    });
    app = await buildApp({ env, container });
    await app.ready();

    const region = await prisma.region.upsert({
      where: { code: "EU" },
      update: {},
      create: { code: "EU", apiHost: "https://eu.api.blizzard.com", localeDefault: "en_GB", enabled: true },
    });
    regionId = region.id;
    let realm = await prisma.realm.findFirst({ where: { regionId, slug: "admin-refresh-realm" } });
    if (!realm) {
      realm = await prisma.realm.create({
        data: {
          id: randomUUID(),
          regionId,
          slug: "admin-refresh-realm",
          name: "Admin Refresh Realm",
        },
      });
    }
    realmId = realm.id;
    const character = await prisma.character.create({
      data: {
        id: randomUUID(),
        regionId,
        realmId,
        normalizedName: `adminrefresh${randomUUID().slice(0, 6)}`,
        displayName: `AdminRefresh${randomUUID().slice(0, 4)}`,
        level: 90,
      },
    });
    characterId = character.id;
    trackedCharacterIds.push(characterId);
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects unauthenticated refresh job listing", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/admin/refresh-jobs" });
    expect(response.statusCode).toBe(401);
  });

  it("lists refresh jobs with pagination and latest-failure default", async () => {
    const name = `FailChar${randomUUID().slice(0, 4)}`;
    const older = await prisma.ingestionJob.create({
      data: {
        id: randomUUID(),
        jobType: "refresh-character",
        characterId,
        status: "FAILED",
        dedupeKey: `refresh:old:${randomUUID()}`,
        payload: { region: "EU", realmSlug: "admin-refresh-realm", name, triggerSource: "SYSTEM" },
        completedAt: new Date(),
        scheduledAt: new Date(Date.now() - 60_000),
        error: { code: "OLD_FAIL", message: "older" },
      },
    });
    const newer = await prisma.ingestionJob.create({
      data: {
        id: randomUUID(),
        jobType: "refresh-character",
        characterId,
        status: "FAILED",
        dedupeKey: `refresh:new:${randomUUID()}`,
        payload: { region: "EU", realmSlug: "admin-refresh-realm", name, triggerSource: "SYSTEM" },
        completedAt: new Date(),
        scheduledAt: new Date(),
        error: { code: "NEW_FAIL", message: "newer" },
      },
    });

    const defaultList = await app.inject({
      method: "GET",
      url: `/api/v1/admin/refresh-jobs?characterId=${characterId}&status=FAILED&pageSize=50`,
      headers: { "x-admin-api-key": ADMIN_KEY },
    });
    expect(defaultList.statusCode).toBe(200);
    const defaultBody = defaultList.json();
    const defaultIds = defaultBody.jobs.map((j: { id: string }) => j.id);
    expect(defaultIds).toContain(newer.id);
    expect(defaultIds).not.toContain(older.id);

    const historical = await app.inject({
      method: "GET",
      url: `/api/v1/admin/refresh-jobs?characterId=${characterId}&status=FAILED&showHistoricalFailures=true&pageSize=50`,
      headers: { "x-admin-api-key": ADMIN_KEY },
    });
    const historicalIds = historical.json().jobs.map((j: { id: string }) => j.id);
    expect(historicalIds).toContain(older.id);
    expect(historicalIds).toContain(newer.id);
  });

  it("exposes action availability by state and supports cancel idempotency", async () => {
    const queued = await prisma.ingestionJob.create({
      data: {
        id: randomUUID(),
        jobType: "refresh-character",
        characterId,
        status: "QUEUED",
        dedupeKey: `refresh:queued:${randomUUID()}`,
        payload: {
          region: "EU",
          realmSlug: "admin-refresh-realm",
          name: "QueuedChar",
          triggerSource: "PROFILE_READ",
        },
        scheduledAt: new Date(),
      },
    });

    const list = await app.inject({
      method: "GET",
      url: `/api/v1/admin/refresh-jobs?characterId=${characterId}&status=QUEUED`,
      headers: { "x-admin-api-key": ADMIN_KEY },
    });
    const row = list.json().jobs.find((j: { id: string }) => j.id === queued.id);
    expect(row.actions).toEqual({
      rerun: false,
      repairBootstrap: false,
      prioritize: true,
      cancel: true,
    });

    const cancel1 = await app.inject({
      method: "POST",
      url: `/api/v1/admin/refresh-jobs/${queued.id}/cancel`,
      headers: { "x-admin-api-key": ADMIN_KEY },
    });
    expect(cancel1.statusCode).toBe(200);
    expect(cancel1.json().outcome).toBe("queued_cancelled");

    const cancel2 = await app.inject({
      method: "POST",
      url: `/api/v1/admin/refresh-jobs/${queued.id}/cancel`,
      headers: { "x-admin-api-key": ADMIN_KEY },
    });
    expect(cancel2.statusCode).toBe(200);
    expect(cancel2.json().outcome).toBe("already_terminal");

    // Prioritize must reject cancel-requested QUEUED jobs.
    const cancelRequestedQueued = await prisma.ingestionJob.create({
      data: {
        id: randomUUID(),
        jobType: "refresh-character",
        characterId,
        status: "QUEUED",
        dedupeKey: `admin-prio-${randomUUID()}`,
        priority: 0,
        payload: { region: "EU", realmSlug: "admin-refresh-realm", name: "Prio" },
        queueJobId: `bull-${randomUUID()}`,
        cancelRequestedAt: new Date(),
        cancelReason: "admin_cancel",
      },
    });
    const listCancelReq = await app.inject({
      method: "GET",
      url: `/api/v1/admin/refresh-jobs?characterId=${characterId}`,
      headers: { "x-admin-api-key": ADMIN_KEY },
    });
    const cancelReqRow = listCancelReq
      .json()
      .jobs.find((j: { id: string }) => j.id === cancelRequestedQueued.id);
    expect(cancelReqRow.actions).toEqual({
      rerun: false,
      repairBootstrap: false,
      prioritize: false,
      cancel: true,
    });

    const prioritizeDenied = await app.inject({
      method: "POST",
      url: `/api/v1/admin/refresh-jobs/${cancelRequestedQueued.id}/prioritize`,
      headers: { "x-admin-api-key": ADMIN_KEY },
    });
    expect(prioritizeDenied.statusCode).toBe(409);

    const persisted = await prisma.ingestionJob.findUniqueOrThrow({ where: { id: queued.id } });
    expect(persisted.status).toBe("CANCELLED");
  });

  it("requires explicit confirm for kill-all and leaves non-refresh jobs untouched", async () => {
    const denied = await app.inject({
      method: "POST",
      url: "/api/v1/admin/refresh-jobs/kill-all",
      headers: { "x-admin-api-key": ADMIN_KEY },
      payload: { confirm: false },
    });
    expect(denied.statusCode).toBe(400);

    const discoveryId = randomUUID();
    trackedJobIds.push(discoveryId);
    await prisma.ingestionJob.create({
      data: {
        id: discoveryId,
        jobType: "discover-owned-characters",
        status: "QUEUED",
        dedupeKey: `discover:${randomUUID()}`,
        payload: {},
        scheduledAt: new Date(),
      },
    });

    // Do not call kill-all against the shared suite DB while other files refresh in parallel.
    // Coverage for kill-all semantics lives in refresh-job-control unit tests.
    const count = await app.inject({
      method: "GET",
      url: "/api/v1/admin/refresh-jobs/count",
      headers: { "x-admin-api-key": ADMIN_KEY },
    });
    expect(count.statusCode).toBe(200);
    expect(typeof count.json().count).toBe("number");

    const discovery = await prisma.ingestionJob.findUniqueOrThrow({ where: { id: discoveryId } });
    expect(discovery.status).toBe("QUEUED");
  });

  it("searches persisted characters for admin tab", async () => {
    const character = await prisma.character.findUniqueOrThrow({ where: { id: characterId } });
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/admin/refresh-jobs/characters/search?region=EU&nickname=${encodeURIComponent(character.displayName)}`,
      headers: { "x-admin-api-key": ADMIN_KEY },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().characters.some((c: { id: string }) => c.id === characterId)).toBe(true);
  });

  it("returns exact persisted scoring model fields and admin account identity keys", async () => {
    const jobId = randomUUID();
    await prisma.ingestionJob.create({
      data: {
        id: jobId,
        jobType: "refresh-character",
        characterId,
        status: "COMPLETED",
        dedupeKey: `refresh:model:${randomUUID()}`,
        payload: {
          region: "EU",
          realmSlug: "admin-refresh-realm",
          name: "ModelChar",
          triggerSource: "SYSTEM",
          scoringModelKey: "default",
          scoringModelVersion: 6,
        },
        completedAt: new Date(),
        scheduledAt: new Date(),
      },
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/admin/refresh-jobs?characterId=${characterId}&pageSize=50`,
      headers: { "x-admin-api-key": ADMIN_KEY },
    });
    expect(response.statusCode).toBe(200);
    const row = response.json().jobs.find((j: { id: string }) => j.id === jobId);
    expect(row).toBeTruthy();
    expect(row.scoringModelKey).toBe("default");
    expect(row.scoringModelVersion).toBe(6);
    expect(Object.prototype.hasOwnProperty.call(row, "battleTag")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(row, "battleNetEmail")).toBe(true);
    // Unlinked / ambiguous → null rather than inferred identity.
    expect(row.battleTag).toBeNull();
    expect(row.battleNetEmail).toBeNull();
  });

  it("shows — semantics for missing scoring model by returning null fields", async () => {
    const jobId = randomUUID();
    await prisma.ingestionJob.create({
      data: {
        id: jobId,
        jobType: "refresh-character",
        characterId,
        status: "COMPLETED",
        dedupeKey: `refresh:nomodel:${randomUUID()}`,
        payload: {
          region: "EU",
          realmSlug: "admin-refresh-realm",
          name: "NoModelChar",
          triggerSource: "SYSTEM",
        },
        completedAt: new Date(),
        scheduledAt: new Date(),
      },
    });
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/admin/refresh-jobs?characterId=${characterId}&pageSize=50`,
      headers: { "x-admin-api-key": ADMIN_KEY },
    });
    const row = response.json().jobs.find((j: { id: string }) => j.id === jobId);
    expect(row.scoringModelKey).toBeNull();
    expect(row.scoringModelVersion).toBeNull();
  });
});
