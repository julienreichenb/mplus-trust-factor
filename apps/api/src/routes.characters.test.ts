import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { normalizeName } from "@mplus/domain";
import type { PrismaClient } from "@mplus/database";
import type { AppEnv } from "@mplus/config";
import {
  clearSeasonAuthorityCacheForTests,
  resolveActiveRefreshContract,
  resolveEnqueueAbilityCatalogExecutionPin,
  seedRefreshEligibilityEvidenceForTest,
  synchronizeSeasonAuthority,
} from "@mplus/worker";
import { buildApp } from "./app.js";
import { createApiContainer, type ApiContainer } from "./container.js";
import {
  buildTestEnv,
  createTestPrismaClient,
  ensureActiveBootstrapCatalogReleaseForTests,
  ensureActiveBootstrapCatalogReleaseUnlocked,
  uniqueName,
  withCatalogActiveTestLock,
} from "./test-helpers.js";

const { prisma, dbAvailable } = await createTestPrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

// Inline refresh fixtures can exceed the default 5s under parallel suite load.
describe.skipIf(!dbAvailable)("character routes", { timeout: 30_000 }, () => {
  let app: FastifyInstance;
  let container: ApiContainer;
  let testEnv: AppEnv;
  let verifiedContractHash: string;
  let verifiedSeasonId: number;

  /** Re-resolve after parallel suites may have flipped ACTIVE catalog releases. */
  async function syncVerifiedContractRef(): Promise<void> {
    const region = await prisma.region.findFirst({ where: { code: "EU" } });
    if (!region) return;
    const authority = await synchronizeSeasonAuthority(
      {
        prisma: container.worker.prisma,
        blizzard: container.worker.providers.blizzard,
        logger: container.logger,
      },
      "EU",
      region.id,
      { forceRefresh: false },
    );
    verifiedSeasonId = authority.blizzardSeasonId;
    const catalogPin = await resolveEnqueueAbilityCatalogExecutionPin({
      prisma: container.worker.prisma,
    });
    verifiedContractHash = resolveActiveRefreshContract({
      scoringModelKey: testEnv.ACTIVE_SCORE_MODEL_KEY,
      scoringModelVersion: testEnv.ACTIVE_SCORE_MODEL_VERSION,
      activeSeasonId: authority.slug,
      providerMode: testEnv.PROVIDER_MODE,
      env: process.env,
      abilityCatalogExecutionPin: catalogPin,
    }).hash;
  }

  /**
   * Holds the cross-worker ACTIVE-catalog advisory lock while inline refresh runs so
   * parallel ability-catalog tests cannot change the execution pin mid-pipeline.
   */
  async function withStableActiveCatalog<T>(fn: () => Promise<T>): Promise<T> {
    return withCatalogActiveTestLock(prisma, async () => {
      await ensureActiveBootstrapCatalogReleaseUnlocked(prisma);
      await syncVerifiedContractRef();
      return await fn();
    });
  }

  beforeEach(async () => {
    await ensureActiveBootstrapCatalogReleaseForTests(prisma);
    container.responseCache.clear();
    await syncVerifiedContractRef();
  });

  beforeAll(async () => {
    clearSeasonAuthorityCacheForTests();
    await ensureActiveBootstrapCatalogReleaseForTests(prisma);
    testEnv = buildTestEnv();
    // `skipQueues: true` runs the refresh pipeline inline (no Redis/BullMQ worker required) so
    // `inject()` tests can observe a persisted score synchronously.
    container = createApiContainer(testEnv, {
      workerOverrides: { prisma: prisma as PrismaClient },
      skipQueues: true,
    });
    app = await buildApp({ env: testEnv, container });
    await app.ready();

    const region = await prisma.region.findFirst({ where: { code: "EU" } });
    if (region) {
      await synchronizeSeasonAuthority(
        {
          prisma: container.worker.prisma,
          blizzard: container.worker.providers.blizzard,
          logger: container.logger,
        },
        "EU",
        region.id,
        { forceRefresh: true },
      );
      await syncVerifiedContractRef();
    }
  });

  afterAll(async () => {
    await app.close();
  });

  const REALM_PATH = "EU/tarren-mill";

  it("returns 202 QUEUED for a never-seen character, then 200 FRESH on the next request", async () => {
    const name = uniqueName("Freshcharacter");
    await seedRefreshEligibilityEvidenceForTest(container.worker, {
      region: "EU",
      realmSlug: "tarren-mill",
      name,
    });

    await withStableActiveCatalog(async () => {
      const first = await app.inject({
        method: "GET",
        url: `/api/v1/characters/${REALM_PATH}/${name}`,
      });
      expect(first.statusCode).toBe(202);
      const firstBody = first.json();
      expect(firstBody.refreshStatus).toBe("QUEUED");
      expect(firstBody.score).toBeNull();

      const second = await app.inject({
        method: "GET",
        url: `/api/v1/characters/${REALM_PATH}/${name}`,
      });
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
  }, 30_000);

  it("marks a score past TTL as needing refresh and arms at most one job", async () => {
    const name = uniqueName("Stalecharacter");
    const path = `/api/v1/characters/${REALM_PATH}/${name}`;
    await seedRefreshEligibilityEvidenceForTest(container.worker, {
      region: "EU",
      realmSlug: "tarren-mill",
      name,
    });

    await withStableActiveCatalog(async () => {
      await app.inject({ method: "GET", url: path });
      const fresh = await app.inject({ method: "GET", url: path });
      expect(fresh.statusCode).toBe(200);
      expect(fresh.json().refreshStatus).toBe("FRESH");
      expect(fresh.json().score).not.toBeNull();

      const character = await prisma.character.findFirst({
        where: { normalizedName: normalizeName(name) },
      });
      expect(character).not.toBeNull();

      // Canonical score freshness is ScoreSnapshot.calculatedAt (not lastPublicRefreshAt).
      const published = await prisma.characterPublishedScore.findFirst({
        where: { characterId: character!.id },
      });
      expect(published).not.toBeNull();
      const staleCalculatedAt = new Date(Date.now() - 8 * 86_400_000);
      await prisma.scoreSnapshot.update({
        where: { id: published!.publishedSnapshotId },
        data: { calculatedAt: staleCalculatedAt },
      });
      // Keep lastPublicRefreshAt recent to prove it alone does not drive STALE.
      await prisma.character.update({
        where: { id: character!.id },
        data: { lastPublicRefreshAt: new Date() },
      });
      container.responseCache.clear();

      const jobsBefore = await prisma.ingestionJob.count({
        where: { characterId: character!.id, jobType: "refresh-character" },
      });

      const response = await app.inject({ method: "GET", url: path });
      expect(response.statusCode).toBe(200);
      // Inline producers finish before the HTTP response; async queues would expose REFRESHING
      // while the job is QUEUED/ACTIVE. Score must remain visible either way.
      expect(["STALE", "REFRESHING", "FRESH"]).toContain(response.json().refreshStatus);
      expect(response.json().score).not.toBeNull();
      expect(response.json().score.overallScore).toBe(fresh.json().score.overallScore);

      const jobsAfterStale = await prisma.ingestionJob.count({
        where: { characterId: character!.id, jobType: "refresh-character" },
      });
      // Inline queue may complete immediately; at most one additional refresh arming.
      expect(jobsAfterStale - jobsBefore).toBeLessThanOrEqual(1);
    });
  }, 30_000);

  it("does not mark STALE when only lastPublicRefreshAt is aged", async () => {
    const name = uniqueName("LastPublicOnly");
    const path = `/api/v1/characters/${REALM_PATH}/${name}`;
    await seedRefreshEligibilityEvidenceForTest(container.worker, {
      region: "EU",
      realmSlug: "tarren-mill",
      name,
    });

    await withStableActiveCatalog(async () => {
      await app.inject({ method: "GET", url: path });
      await app.inject({ method: "GET", url: path });

      const character = await prisma.character.findFirst({
        where: { normalizedName: normalizeName(name) },
      });
      expect(character).not.toBeNull();
      await prisma.character.update({
        where: { id: character!.id },
        data: { lastPublicRefreshAt: new Date(Date.now() - 999_999_999_999) },
      });
      container.responseCache.clear();

      const response = await app.inject({ method: "GET", url: path });
      expect(response.statusCode).toBe(200);
      expect(response.json().refreshStatus).toBe("FRESH");
      expect(response.json().score).not.toBeNull();
    });
  });

  it("reuses an active refresh job on repeated stale reads", async () => {
    const name = uniqueName("ReuseStaleJob");
    const path = `/api/v1/characters/${REALM_PATH}/${name}`;
    await seedRefreshEligibilityEvidenceForTest(container.worker, {
      region: "EU",
      realmSlug: "tarren-mill",
      name,
    });

    await withStableActiveCatalog(async () => {
      await app.inject({ method: "GET", url: path });
      await app.inject({ method: "GET", url: path });

      const character = await prisma.character.findFirst({
        where: { normalizedName: normalizeName(name) },
      });
      expect(character).not.toBeNull();

      const published = await prisma.characterPublishedScore.findFirst({
        where: { characterId: character!.id },
      });
      expect(published).not.toBeNull();
      await prisma.scoreSnapshot.update({
        where: { id: published!.publishedSnapshotId },
        data: { calculatedAt: new Date(Date.now() - 8 * 86_400_000) },
      });

      // Simulate an in-flight job so policy must REUSE_ACTIVE_JOB (no second enqueue).
      await prisma.ingestionJob.updateMany({
        where: { characterId: character!.id, jobType: "refresh-character" },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
      const active = await prisma.ingestionJob.create({
        data: {
          jobType: "refresh-character",
          status: "QUEUED",
          characterId: character!.id,
          dedupeKey: `test-reuse-${character!.id}`,
          payload: {
            region: "EU",
            realmSlug: "tarren-mill",
            name,
            refreshContractHash: verifiedContractHash,
            authoritativeSeasonId: verifiedSeasonId,
          },
          priority: 0,
          scheduledAt: new Date(),
        },
      });
      container.responseCache.clear();

      const first = await app.inject({ method: "GET", url: path });
      expect(first.statusCode).toBe(200);
      expect(first.json().refreshStatus).toBe("REFRESHING");
      expect(first.json().score).not.toBeNull();

      const queuedCount = await prisma.ingestionJob.count({
        where: {
          characterId: character!.id,
          jobType: "refresh-character",
          status: { in: ["QUEUED", "ACTIVE"] },
        },
      });
      expect(queuedCount).toBe(1);

      container.responseCache.clear();
      const second = await app.inject({ method: "GET", url: path });
      expect(second.statusCode).toBe(200);
      expect(second.json().refreshStatus).toBe("REFRESHING");
      expect(second.json().score).not.toBeNull();

      const queuedAgain = await prisma.ingestionJob.count({
        where: {
          characterId: character!.id,
          jobType: "refresh-character",
          status: { in: ["QUEUED", "ACTIVE"] },
        },
      });
      expect(queuedAgain).toBe(1);
      expect(active.id).toBeTruthy();
    });
  });

  it("returns 404 for a confirmed not-found identity on the second request", async () => {
    const name = uniqueName("MissingCharacter");

    const first = await app.inject({
      method: "POST",
      url: "/api/v1/characters/resolve",
      payload: { name, realmSlug: "tarren-mill", region: "EU" },
    });
    expect(first.statusCode).toBe(404);

    const second = await app.inject({
      method: "GET",
      url: `/api/v1/characters/${REALM_PATH}/${name}`,
    });
    expect(second.statusCode).toBe(404);
    expect(second.json().error.code).toBe("CHARACTER_NOT_FOUND");
    expect(second.json().error.requestId).toBeTruthy();
  });

  it("lets the emergency admin key bypass the manual refresh cooldown", async () => {
    const name = uniqueName("Cooldowncharacter");
    await seedRefreshEligibilityEvidenceForTest(container.worker, {
      region: "EU",
      realmSlug: "tarren-mill",
      name,
    });

    const first = await app.inject({
      method: "POST",
      url: `/api/v1/characters/${REALM_PATH}/${name}/refresh`,
      headers: { "x-admin-api-key": "test-admin-key" },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().cooldownSecondsRemaining).toBe(0);

    const second = await app.inject({
      method: "POST",
      url: `/api/v1/characters/${REALM_PATH}/${name}/refresh`,
      headers: { "x-admin-api-key": "test-admin-key" },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().cooldownSecondsRemaining).toBe(0);
  });

  it("exposes job status via GET /jobs/:id after a refresh completes", async () => {
    const name = uniqueName("JobLookupCharacter");
    await seedRefreshEligibilityEvidenceForTest(container.worker, {
      region: "EU",
      realmSlug: "tarren-mill",
      name,
    });

    const refreshResponse = await app.inject({
      method: "POST",
      url: `/api/v1/characters/${REALM_PATH}/${name}/refresh`,
      headers: { "x-admin-api-key": "test-admin-key" },
    });
    const jobId = refreshResponse.json().job?.jobId as string | undefined;
    expect(jobId).toBeTruthy();

    const jobResponse = await app.inject({ method: "GET", url: `/api/v1/jobs/${jobId}` });
    expect(jobResponse.statusCode).toBe(200);
    expect(jobResponse.json().status).toBe("completed");
  });

  it("runs a second admin refresh after COMPLETED with the same dedupe key", async () => {
    const name = uniqueName("SecondRefresh");
    const path = `/api/v1/characters/${REALM_PATH}/${name}/refresh`;
    await seedRefreshEligibilityEvidenceForTest(container.worker, {
      region: "EU",
      realmSlug: "tarren-mill",
      name,
    });

    const first = await app.inject({
      method: "POST",
      url: path,
      headers: { "x-admin-api-key": "test-admin-key" },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().job?.status).toBe("completed");
    const firstJobId = first.json().job?.jobId as string;
    const firstFinishedAt = first.json().job?.finishedAt as string | null;

    const second = await app.inject({
      method: "POST",
      url: path,
      headers: { "x-admin-api-key": "test-admin-key" },
    });
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
    await seedRefreshEligibilityEvidenceForTest(container.worker, {
      region: "EU",
      realmSlug: "tarren-mill",
      name,
    });

    await withStableActiveCatalog(async () => {
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
        payload: {
          region: "EU",
          realmSlug: "tarren-mill",
          name,
          refreshContractHash: verifiedContractHash,
          authoritativeSeasonId: verifiedSeasonId,
        },
      });
      expect(queued.job.status).toBe("QUEUED");

      const [a, b] = await Promise.all([
        app.inject({
          method: "POST",
          url: `/api/v1/characters/${REALM_PATH}/${name}/refresh`,
          headers: { "x-admin-api-key": "test-admin-key" },
        }),
        app.inject({
          method: "POST",
          url: `/api/v1/characters/${REALM_PATH}/${name}/refresh`,
          headers: { "x-admin-api-key": "test-admin-key" },
        }),
      ]);
      expect(a.statusCode).toBe(200);
      expect(b.statusCode).toBe(200);
      expect(a.json().job?.jobId).toBe(queued.job.id);
      expect(b.json().job?.jobId).toBe(queued.job.id);
      expect(["queued", "QUEUED", "in_progress", "IN_PROGRESS"]).toContain(
        String(a.json().job?.status).toLowerCase(),
      );
    });
  });

  it("exposes public enrichment fields without inventing item level zero", async () => {
    const name = uniqueName("EnrichmentFields");
    await seedRefreshEligibilityEvidenceForTest(container.worker, {
      region: "EU",
      realmSlug: "tarren-mill",
      name,
    });
    await app.inject({ method: "GET", url: `/api/v1/characters/${REALM_PATH}/${name}` });
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/characters/${REALM_PATH}/${name}`,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty("equipment");
    expect(body).toHaveProperty("media");
    expect(body).toHaveProperty("talents");
    expect(body).toHaveProperty("providerStates");
    expect(body).toHaveProperty("sources");
    if (body.equipment?.items) {
      for (const item of body.equipment.items) {
        expect(item.itemLevel === null || item.itemLevel > 0).toBe(true);
        if (item.iconUrl) expect(String(item.iconUrl)).toMatch(/^https:\/\//);
      }
    }
    const raw = JSON.stringify(body);
    expect(raw).not.toMatch(/reportCode|client_secret|access_token/i);
  });

  it("refresh-status reaches a terminal FRESH state after successful inline refresh", async () => {
    const name = uniqueName("RefreshPollTerminal");
    await seedRefreshEligibilityEvidenceForTest(container.worker, {
      region: "EU",
      realmSlug: "tarren-mill",
      name,
    });

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
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/jobs/00000000-0000-0000-0000-000000000000",
    });
    expect(response.statusCode).toBe(404);
  });

  it("rejects unauthenticated POST /refresh", async () => {
    const name = uniqueName("NormalRefreshOk");
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/characters/${REALM_PATH}/${name}/refresh`,
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("UNAUTHORIZED");
  });

  it("denies ?force=true for authenticated users without profile.refresh.force", async () => {
    const name = uniqueName("ForceDenied");
    const user = await prisma.user.create({
      data: {
        id: randomUUID(),
        authProvider: "battlenet",
        externalSubject: `force-denied-${randomUUID()}`,
        displayName: "ForceDenied",
        role: "USER",
      },
    });
    const token = await container.authService.createSession({ userId: user.id });
    const denied = await app.inject({
      method: "POST",
      url: `/api/v1/characters/${REALM_PATH}/${name}/refresh?force=true`,
      headers: { cookie: `mplus_session=${token}` },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe("FORBIDDEN");
  });

  it("admin-key ?force=true succeeds and concurrent forced posts reuse one active job", async () => {
    const name = uniqueName("ForceAdminOk");
    await seedRefreshEligibilityEvidenceForTest(container.worker, {
      region: "EU",
      realmSlug: "tarren-mill",
      name,
    });

    await withStableActiveCatalog(async () => {
      const character = await container.worker.repositories.character.upsertCharacter(
        { region: "EU", realmSlug: "tarren-mill", name },
        { displayName: name },
      );
      const active = await prisma.ingestionJob.create({
        data: {
          jobType: "refresh-character",
          status: "QUEUED",
          characterId: character.id,
          dedupeKey: `force-reuse-${character.id}`,
          payload: {
            forceRefresh: true,
            refreshContractHash: verifiedContractHash,
            authoritativeSeasonId: verifiedSeasonId,
          },
          priority: 0,
          scheduledAt: new Date(),
        },
      });

      const [a, b] = await Promise.all([
        app.inject({
          method: "POST",
          url: `/api/v1/characters/${REALM_PATH}/${name}/refresh?force=true`,
          headers: { "x-admin-api-key": "test-admin-key" },
        }),
        app.inject({
          method: "POST",
          url: `/api/v1/characters/${REALM_PATH}/${name}/refresh?force=true`,
          headers: { "x-admin-api-key": "test-admin-key" },
        }),
      ]);
      expect(a.statusCode).toBe(200);
      expect(b.statusCode).toBe(200);
      expect(a.json().job?.jobId).toBe(active.id);
      expect(b.json().job?.jobId).toBe(active.id);

      const activeCount = await prisma.ingestionJob.count({
        where: {
          characterId: character.id,
          jobType: "refresh-character",
          status: { in: ["QUEUED", "ACTIVE"] },
        },
      });
      expect(activeCount).toBe(1);
    });
  });

  it("stale GET still returns published score and enqueues at most once", async () => {
    const name = uniqueName("StaleOnceMore");
    const path = `/api/v1/characters/${REALM_PATH}/${name}`;
    await seedRefreshEligibilityEvidenceForTest(container.worker, {
      region: "EU",
      realmSlug: "tarren-mill",
      name,
    });
    await app.inject({ method: "GET", url: path });
    await app.inject({ method: "GET", url: path });

    const character = await prisma.character.findFirst({
      where: { normalizedName: normalizeName(name) },
    });
    expect(character).not.toBeNull();
    const published = await prisma.characterPublishedScore.findFirst({
      where: { characterId: character!.id },
    });
    expect(published).not.toBeNull();
    await prisma.scoreSnapshot.update({
      where: { id: published!.publishedSnapshotId },
      data: { calculatedAt: new Date(Date.now() - 8 * 86_400_000) },
    });
    container.responseCache.clear();

    const before = await prisma.ingestionJob.count({
      where: { characterId: character!.id, jobType: "refresh-character" },
    });
    const first = await app.inject({ method: "GET", url: path });
    const second = await app.inject({ method: "GET", url: path });
    expect(first.statusCode).toBe(200);
    expect(first.json().score).not.toBeNull();
    expect(["STALE", "REFRESHING", "FRESH"]).toContain(first.json().refreshStatus);
    expect(second.json().score).not.toBeNull();
    expect(["REFRESHING", "STALE", "FRESH"]).toContain(second.json().refreshStatus);
    const after = await prisma.ingestionJob.count({
      where: { characterId: character!.id, jobType: "refresh-character" },
    });
    expect(after - before).toBeLessThanOrEqual(1);
  });

  it("rejects anonymous Active rerolls requests", async () => {
    const name = uniqueName("RerollAnon");
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/characters/${REALM_PATH}/${name}/active-rerolls`,
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("UNAUTHORIZED");
  });

  it("allows any authenticated viewer to read Active rerolls for a character they do not own", async () => {
    const name = uniqueName("RerollViewer");
    const viewer = await prisma.user.create({
      data: {
        id: randomUUID(),
        authProvider: "battlenet",
        externalSubject: `reroll-viewer-${randomUUID()}`,
        displayName: "RerollViewer",
        role: "USER",
      },
    });
    const token = await container.authService.createSession({ userId: viewer.id });
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/characters/${REALM_PATH}/${name}/active-rerolls`,
      headers: { cookie: `mplus_session=${token}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ displayedCharacterIsMain: false, rerolls: [] });
    const serialized = JSON.stringify(response.json());
    expect(serialized).not.toMatch(
      /battletag|providerAccountId|userId|ownershipId|email|relevanceEligible/i,
    );
  });

  it("returns owner A rerolls to authenticated non-owner B without mixing B roster", async () => {
    const region = await prisma.region.findFirst({ where: { code: "EU" } });
    expect(region).not.toBeNull();
    const realm = await prisma.realm.findFirst({
      where: { regionId: region!.id, slug: "tarren-mill" },
    });
    expect(realm).not.toBeNull();

    const ownerA = await prisma.user.create({
      data: {
        id: randomUUID(),
        authProvider: "battlenet",
        externalSubject: `reroll-a-${randomUUID()}`,
        displayName: "OwnerA",
        role: "USER",
      },
    });
    const viewerB = await prisma.user.create({
      data: {
        id: randomUUID(),
        authProvider: "battlenet",
        externalSubject: `reroll-b-${randomUUID()}`,
        displayName: "ViewerB",
        role: "USER",
      },
    });

    const accountA = await prisma.battleNetAccount.create({
      data: {
        id: randomUUID(),
        userId: ownerA.id,
        providerAccountId: `bnet-a-${randomUUID()}`,
        battletagHash: `hash-a-${randomUUID()}`,
        battletagDisplay: "OwnerA#1",
        claimed: true,
        unlinkedAt: null,
      },
    });
    const accountB = await prisma.battleNetAccount.create({
      data: {
        id: randomUUID(),
        userId: viewerB.id,
        providerAccountId: `bnet-b-${randomUUID()}`,
        battletagHash: `hash-b-${randomUUID()}`,
        battletagDisplay: "ViewerB#2",
        claimed: true,
        unlinkedAt: null,
      },
    });

    const mainName = uniqueName("MainA");
    const altName = uniqueName("AltA");
    const bOnlyName = uniqueName("OnlyB");

    const mainChar = await container.worker.repositories.character.upsertCharacter(
      { region: "EU", realmSlug: "tarren-mill", name: mainName },
      { displayName: mainName },
    );
    const altChar = await container.worker.repositories.character.upsertCharacter(
      { region: "EU", realmSlug: "tarren-mill", name: altName },
      { displayName: altName },
    );
    const bChar = await container.worker.repositories.character.upsertCharacter(
      { region: "EU", realmSlug: "tarren-mill", name: bOnlyName },
      { displayName: bOnlyName },
    );

    const now = new Date();
    await prisma.verifiedCharacterOwnership.createMany({
      data: [
        {
          id: randomUUID(),
          battleNetAccountId: accountA.id,
          userId: ownerA.id,
          characterId: mainChar.id,
          blizzardCharacterId: BigInt(800_000_000 + Math.floor(Math.random() * 1_000_000)),
          regionId: region!.id,
          realmSlug: "tarren-mill",
          realmName: "Tarren Mill",
          characterName: mainName,
          normalizedName: normalizeName(mainName),
          confidence: "CONFIRMED",
          source: "test",
          status: "CURRENT",
          isPrimary: true,
          verifiedAt: now,
          revokedAt: null,
          relevanceEligible: true,
          currentSeasonMythicRating: 3200,
        },
        {
          id: randomUUID(),
          battleNetAccountId: accountA.id,
          userId: ownerA.id,
          characterId: altChar.id,
          blizzardCharacterId: BigInt(810_000_000 + Math.floor(Math.random() * 1_000_000)),
          regionId: region!.id,
          realmSlug: "tarren-mill",
          realmName: "Tarren Mill",
          characterName: altName,
          normalizedName: normalizeName(altName),
          confidence: "CONFIRMED",
          source: "test",
          status: "CURRENT",
          isPrimary: false,
          verifiedAt: now,
          revokedAt: null,
          relevanceEligible: true,
          currentSeasonMythicRating: 2100,
        },
        {
          id: randomUUID(),
          battleNetAccountId: accountB.id,
          userId: viewerB.id,
          characterId: bChar.id,
          blizzardCharacterId: BigInt(820_000_000 + Math.floor(Math.random() * 1_000_000)),
          regionId: region!.id,
          realmSlug: "tarren-mill",
          realmName: "Tarren Mill",
          characterName: bOnlyName,
          normalizedName: normalizeName(bOnlyName),
          confidence: "CONFIRMED",
          source: "test",
          status: "CURRENT",
          isPrimary: true,
          verifiedAt: now,
          revokedAt: null,
          relevanceEligible: true,
          currentSeasonMythicRating: 9999,
        },
      ],
    });

    const tokenB = await container.authService.createSession({ userId: viewerB.id });
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/characters/${REALM_PATH}/${mainName}/active-rerolls`,
      headers: { cookie: `mplus_session=${tokenB}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.displayedCharacterIsMain).toBe(true);
    expect(body.rerolls).toHaveLength(1);
    expect(body.rerolls[0].name).toBe(altName);
    expect(body.rerolls[0].isMain).toBe(false);
    expect(body.rerolls.map((r: { name: string }) => r.name)).not.toContain(bOnlyName);
    expect(JSON.stringify(body)).not.toMatch(
      /OwnerA#1|ViewerB#2|battletag|providerAccountId|ownershipId/i,
    );
  });

  it("public autocomplete starts at 2 chars, caps at 8, and omits characterId/ownership", async () => {
    const names = Array.from({ length: 10 }, (_, i) => uniqueName(`Ac${i}xx`));
    for (const name of names) {
      await seedRefreshEligibilityEvidenceForTest(container.worker, {
        region: "EU",
        realmSlug: "tarren-mill",
        name,
      });
    }

    const tooShort = await app.inject({
      method: "GET",
      url: "/api/v1/characters/autocomplete?region=EU&query=A",
    });
    expect(tooShort.statusCode).toBe(400);

    const prefix = names[0]!.slice(0, 2);
    const ok = await app.inject({
      method: "GET",
      url: `/api/v1/characters/autocomplete?region=EU&query=${encodeURIComponent(prefix)}`,
    });
    expect(ok.statusCode).toBe(200);
    const body = ok.json() as { suggestions: Array<Record<string, unknown>> };
    expect(body.suggestions.length).toBeGreaterThan(0);
    expect(body.suggestions.length).toBeLessThanOrEqual(8);
    for (const suggestion of body.suggestions) {
      expect(suggestion).not.toHaveProperty("characterId");
      expect(suggestion).not.toHaveProperty("battletag");
      expect(suggestion).not.toHaveProperty("mythicPlusScore");
      expect(suggestion).not.toHaveProperty("overallScore");
      expect(typeof suggestion.name).toBe("string");
      expect(typeof suggestion.realmSlug).toBe("string");
      expect(suggestion.region).toBe("EU");
    }
  });

  it("resolve profile-only path does not enqueue when character is ineligible", async () => {
    const name = uniqueName("LowLevelResolve");
    // Seed below max level with no mythic rating eligibility.
    const seeded = await seedRefreshEligibilityEvidenceForTest(container.worker, {
      region: "EU",
      realmSlug: "tarren-mill",
      name,
      level: 80,
      mythicRating: null,
    });

    const unrelated = uniqueName("UnrelatedRefresh");
    const unrelatedSeed = await seedRefreshEligibilityEvidenceForTest(container.worker, {
      region: "EU",
      realmSlug: "tarren-mill",
      name: unrelated,
    });
    await prisma.ingestionJob.create({
      data: {
        jobType: "refresh-character",
        characterId: unrelatedSeed.characterId,
        status: "QUEUED",
        dedupeKey: `test-unrelated-${unrelatedSeed.characterId}`,
        payload: {
          region: "EU",
          realmSlug: "tarren-mill",
          name: unrelated,
        },
        priority: 0,
        scheduledAt: new Date(),
      },
    });

    const jobWhere = { characterId: seeded.characterId, jobType: "refresh-character" as const };
    const before = await prisma.ingestionJob.count({ where: jobWhere });

    const resolved = await app.inject({
      method: "POST",
      url: "/api/v1/characters/resolve",
      payload: { name, realmSlug: "tarren-mill", region: "EU" },
    });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json().status).toBe("READY");
    expect(resolved.json().refreshId).toBeUndefined();
    expect(resolved.json().profilePath).toContain(name);

    const after = await prisma.ingestionJob.count({ where: jobWhere });
    expect(after).toBe(before);

    const refresh = await app.inject({
      method: "POST",
      url: `/api/v1/characters/${REALM_PATH}/${name}/refresh`,
      headers: { "x-admin-api-key": "test-admin-key" },
    });
    expect(refresh.statusCode).toBe(409);
    expect(refresh.json().error.code).toBe("CHARACTER_BELOW_MAX_LEVEL");
  });
});
