/**
 * H4 adversarial HTTP coverage for Scoring V2 Control Center routes.
 * Real Fastify inject + real permission middleware. Mock queue producers only.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@mplus/database";
import type { QueueProducers } from "@mplus/worker";
import { buildApp } from "./app.js";
import { createApiContainer, type ApiContainer } from "./container.js";
import { buildTestEnv, createTestPrismaClient, uniqueName } from "./test-helpers.js";
import { ensureIamSeed } from "./iam/seed.js";
import { grantAdminRole } from "./iam/grant-admin.js";
import { BATTLENET_PROVIDER, PERMISSIONS } from "./iam/permissions.js";
import { RUNTIME_SETTING_KEYS } from "@mplus/contracts";

const { prisma, dbAvailable } = await createTestPrismaClient();
const ADMIN_KEY = "test-admin-key-scoring-cc";

const CONTROL_CENTER_GET_PATHS = [
  "/api/v1/admin/scoring/overview",
  "/api/v1/admin/scoring/concurrency",
  "/api/v1/admin/scoring/evidence-exports",
  "/api/v1/admin/scoring/history",
] as const;

afterAll(async () => {
  await prisma.$disconnect();
});

function stubProducers(spies: {
  enqueueScoringEvidenceExport: ReturnType<typeof vi.fn>;
  enqueueRefreshCharacter: ReturnType<typeof vi.fn>;
}): QueueProducers {
  const ok = async () => ({
    jobId: randomUUID(),
    dedupeKey: `stub-${randomUUID()}`,
    reused: false,
    enqueued: true,
  });
  return {
    enqueueRefreshCharacter: spies.enqueueRefreshCharacter,
    enqueueAnalyzeRun: ok,
    enqueueRecalculateScore: ok,
    enqueueGenerateAddonExport: ok,
    enqueueDiscoverOwnedCharacters: ok,
    enqueueBulkCharacterProcessing: ok,
    enqueueCalibrationRun: ok,
    enqueueScoringEvidenceExport: spies.enqueueScoringEvidenceExport,
    enqueueAnalyzeEvidenceSlot: ok,
    enqueueFinalizeEvidenceBatch: ok,
    getRefreshCharacterQueue: () => null,
    getCalibrationRunQueue: () => null,
    close: async () => undefined,
  } as QueueProducers;
}

function assertNoSecrets(body: unknown): void {
  const raw = JSON.stringify(body);
  expect(raw).not.toMatch(/DATABASE_URL/i);
  expect(raw).not.toMatch(/postgresql:\/\//i);
  expect(raw).not.toMatch(/redis:\/\//i);
  expect(raw).not.toMatch(/REDIS_URL/i);
  expect(raw).not.toMatch(/SESSION_SECRET/i);
}

async function createUser(displayName: string) {
  const subject = `subj-sv2cc-${randomUUID()}`;
  return prisma.user.create({
    data: {
      id: randomUUID(),
      authProvider: BATTLENET_PROVIDER,
      externalSubject: subject,
      displayName,
      role: "USER",
    },
  });
}

/** Role with score.candidate.read only — not admin.scoring.manage. */
async function grantCandidateReadOnly(userId: string): Promise<void> {
  await ensureIamSeed(prisma as PrismaClient);
  const roleKey = `sv2cc-read-${randomUUID().slice(0, 8)}`;
  const role = await prisma.role.create({
    data: {
      id: randomUUID(),
      key: roleKey,
      name: "Scoring V2 candidate read",
      description: "Test-only read permission for control-center authz",
    },
  });
  const permission = await prisma.permission.findUnique({
    where: { key: PERMISSIONS.SCORE_CANDIDATE_READ },
  });
  if (!permission) throw new Error("score.candidate.read permission missing after IAM seed");
  await prisma.rolePermission.create({
    data: { roleId: role.id, permissionId: permission.id },
  });
  await prisma.userRoleAssignment.create({
    data: { id: randomUUID(), userId, roleId: role.id },
  });
}

async function ensureSeasonId(): Promise<string> {
  const existing = await prisma.season.findFirst({ orderBy: { createdAt: "asc" } });
  if (existing) return existing.id;
  const region = await prisma.region.findFirst();
  if (!region) throw new Error("No region for season fixture");
  const id = randomUUID();
  await prisma.season.create({
    data: {
      id,
      slug: `sv2cc-${id.slice(0, 8)}`,
      name: "Scoring V2 CC Test Season",
      regionId: region.id,
    },
  });
  return id;
}

async function createCohort(createdByUserId: string, seasonId: string) {
  return prisma.calibrationCohort.create({
    data: {
      id: randomUUID(),
      name: uniqueName("sv2cc-cohort"),
      description: "control-center adversarial fixture",
      seasonId,
      status: "DRAFT",
      revision: 1,
      createdByUserId,
    },
  });
}

describe.skipIf(!dbAvailable)("admin scoring control center (H4 adversarial)", { timeout: 60_000 }, () => {
  let app: FastifyInstance;
  let container: ApiContainer;
  let sessionSecret: string;
  let seasonId: string;
  let actorUserId: string;

  const enqueueExport = vi.fn(async (input: { exportId: string }) => ({
    jobId: input.exportId,
    dedupeKey: input.exportId,
    reused: false,
    enqueued: true,
  }));
  const enqueueRefresh = vi.fn(async () => ({
    jobId: randomUUID(),
    dedupeKey: randomUUID(),
    reused: false,
    enqueued: true,
  }));

  beforeAll(async () => {
    const env = buildTestEnv({
      ADMIN_API_KEY: ADMIN_KEY,
      ADMIN_API_KEY_EMERGENCY_FALLBACK: "true",
    });
    sessionSecret = env.SESSION_SECRET;
    seasonId = await ensureSeasonId();
    const actor = await createUser(uniqueName("Sv2CcActor"));
    actorUserId = actor.id;
    await ensureIamSeed(prisma as PrismaClient);

    container = createApiContainer(env, {
      workerOverrides: { prisma: prisma as PrismaClient },
      producers: stubProducers({
        enqueueScoringEvidenceExport: enqueueExport,
        enqueueRefreshCharacter: enqueueRefresh,
      }),
    });
    app = await buildApp({ env, container });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  function adminKeyHeaders() {
    return { "x-admin-api-key": ADMIN_KEY };
  }

  async function sessionCookieFor(userId: string): Promise<string> {
    const token = await container.authService.createSession({ userId });
    return `mplus_session=${token}`;
  }

  it("provisions control-center permission keys", () => {
    expect(PERMISSIONS.SCORE_CANDIDATE_READ).toBe("score.candidate.read");
    expect(PERMISSIONS.ADMIN_SCORING_MANAGE).toBe("admin.scoring.manage");
  });

  describe("unauthenticated → 401", () => {
    for (const path of CONTROL_CENTER_GET_PATHS) {
      it(`GET ${path}`, async () => {
        const response = await app.inject({ method: "GET", url: path });
        expect(response.statusCode).toBe(401);
        expect(response.json().error.code).toBe("UNAUTHORIZED");
        assertNoSecrets(response.json());
      });
    }

    it("PUT /concurrency", async () => {
      const response = await app.inject({
        method: "PUT",
        url: "/api/v1/admin/scoring/concurrency",
        payload: { concurrencyCalibration: 2, expectedVersion: 1 },
      });
      expect(response.statusCode).toBe(401);
    });

    it("POST /evidence-exports", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/admin/scoring/evidence-exports",
        payload: { cohortId: randomUUID() },
      });
      expect(response.statusCode).toBe(401);
    });

    it("GET /evidence-exports/:id", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/admin/scoring/evidence-exports/${randomUUID()}`,
      });
      expect(response.statusCode).toBe(401);
    });

    it("GET download", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/admin/scoring/evidence-exports/${randomUUID()}/download`,
      });
      expect(response.statusCode).toBe(401);
    });

    it("POST freeze-bundle", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/admin/scoring/evidence-exports/${randomUUID()}/freeze-bundle`,
        payload: { confirm: true },
      });
      expect(response.statusCode).toBe(401);
    });
  });

  describe("authenticated without permission → 403", () => {
    it("normal user cannot read overview or mutate concurrency", async () => {
      const user = await createUser(uniqueName("NoPerm"));
      const cookie = await sessionCookieFor(user.id);

      const overview = await app.inject({
        method: "GET",
        url: "/api/v1/admin/scoring/overview",
        headers: { cookie },
      });
      expect(overview.statusCode).toBe(403);
      expect(overview.json().error.code).toBe("FORBIDDEN");

      const put = await app.inject({
        method: "PUT",
        url: "/api/v1/admin/scoring/concurrency",
        headers: { cookie },
        payload: { concurrencyCalibration: 2, expectedVersion: 1 },
      });
      expect(put.statusCode).toBe(403);
      assertNoSecrets(put.json());
    });
  });

  describe("score.candidate.read can GET but not mutate/download/freeze", () => {
    let readCookie: string;

    beforeAll(async () => {
      const user = await createUser(uniqueName("CandRead"));
      await grantCandidateReadOnly(user.id);
      readCookie = await sessionCookieFor(user.id);
    });

    it("allows GET overview, concurrency, list, history, and export detail", async () => {
      for (const path of CONTROL_CENTER_GET_PATHS) {
        const response = await app.inject({
          method: "GET",
          url: path,
          headers: { cookie: readCookie },
        });
        expect(response.statusCode).toBe(200);
        assertNoSecrets(response.json());
      }

      const missing = await app.inject({
        method: "GET",
        url: `/api/v1/admin/scoring/evidence-exports/${randomUUID()}`,
        headers: { cookie: readCookie },
      });
      // Authz passed; resource missing.
      expect(missing.statusCode).toBe(404);
      expect(missing.json().error.code).toBe("EXPORT_NOT_FOUND");
    });

    it("denies PUT concurrency, POST export, download, and freeze with 403", async () => {
      const exportId = randomUUID();
      const cases = [
        app.inject({
          method: "PUT",
          url: "/api/v1/admin/scoring/concurrency",
          headers: { cookie: readCookie },
          payload: { concurrencyCalibration: 2, expectedVersion: 1 },
        }),
        app.inject({
          method: "POST",
          url: "/api/v1/admin/scoring/evidence-exports",
          headers: { cookie: readCookie },
          payload: { cohortId: randomUUID() },
        }),
        app.inject({
          method: "GET",
          url: `/api/v1/admin/scoring/evidence-exports/${exportId}/download`,
          headers: { cookie: readCookie },
        }),
        app.inject({
          method: "POST",
          url: `/api/v1/admin/scoring/evidence-exports/${exportId}/freeze-bundle`,
          headers: { cookie: readCookie },
          payload: { confirm: true },
        }),
      ];
      const results = await Promise.all(cases);
      for (const response of results) {
        expect(response.statusCode).toBe(403);
        expect(response.json().error.code).toBe("FORBIDDEN");
        assertNoSecrets(response.json());
      }
    });
  });

  describe("manage permission mutations", () => {
    let manageCookie: string;

    beforeAll(async () => {
      const adminUser = await createUser(uniqueName("Sv2Manage"));
      await grantAdminRole(
        prisma as PrismaClient,
        { kind: "userId", userId: adminUser.id },
        { sessionSecret, actorLabel: "sv2cc-test" },
      );
      manageCookie = await sessionCookieFor(adminUser.id);
    });

    it("PUT concurrency succeeds with manage session", async () => {
      // Ensure defaults exist and read current version.
      const current = await app.inject({
        method: "GET",
        url: "/api/v1/admin/scoring/concurrency",
        headers: { cookie: manageCookie },
      });
      expect(current.statusCode).toBe(200);
      const version = current.json().settingsVersion as number;

      const updated = await app.inject({
        method: "PUT",
        url: "/api/v1/admin/scoring/concurrency",
        headers: { cookie: manageCookie },
        payload: {
          concurrencyCalibration: 3,
          expectedVersion: version,
        },
      });
      expect(updated.statusCode).toBe(200);
      expect(updated.json().calibration.configured).toBe(3);
      expect(updated.json().settingsVersion).toBe(version + 1);
      assertNoSecrets(updated.json());
    });

    it("POST evidence-exports enqueues export job and does not enqueue refresh", async () => {
      enqueueExport.mockClear();
      enqueueRefresh.mockClear();
      const cohort = await createCohort(actorUserId, seasonId);

      const created = await app.inject({
        method: "POST",
        url: "/api/v1/admin/scoring/evidence-exports",
        headers: { cookie: manageCookie },
        payload: { cohortId: cohort.id },
      });
      expect(created.statusCode).toBe(200);
      expect(created.json().cohortId).toBe(cohort.id);
      expect(created.json().status).toBe("QUEUED");
      expect(enqueueExport).toHaveBeenCalledTimes(1);
      expect(enqueueExport).toHaveBeenCalledWith(
        expect.objectContaining({ exportId: created.json().id }),
      );
      expect(enqueueRefresh).not.toHaveBeenCalled();
      assertNoSecrets(created.json());
    });

    it("admin API key can GET overview and list exports", async () => {
      const overview = await app.inject({
        method: "GET",
        url: "/api/v1/admin/scoring/overview",
        headers: adminKeyHeaders(),
      });
      expect(overview.statusCode).toBe(200);
      expect(overview.json()).toHaveProperty("flags");
      expect(overview.json()).toHaveProperty("concurrency");

      const list = await app.inject({
        method: "GET",
        url: "/api/v1/admin/scoring/evidence-exports?page=1&pageSize=5",
        headers: adminKeyHeaders(),
      });
      expect(list.statusCode).toBe(200);
      expect(list.json().pageSize).toBeLessThanOrEqual(50);
      assertNoSecrets(list.json());
    });
  });

  describe("validation / conflicts / not-found", () => {
    it("rejects malformed UUID params with 400", async () => {
      const badId = "not-a-uuid";
      const paths = [
        `/api/v1/admin/scoring/evidence-exports/${badId}`,
        `/api/v1/admin/scoring/evidence-exports/${badId}/download`,
      ];
      for (const url of paths) {
        const response = await app.inject({
          method: "GET",
          url,
          headers: adminKeyHeaders(),
        });
        expect(response.statusCode).toBe(400);
        assertNoSecrets(response.json());
      }

      const freeze = await app.inject({
        method: "POST",
        url: `/api/v1/admin/scoring/evidence-exports/${badId}/freeze-bundle`,
        headers: adminKeyHeaders(),
        payload: { confirm: true },
      });
      expect(freeze.statusCode).toBe(400);
    });

    it("rejects missing concurrency body and out-of-range values with 400", async () => {
      const missing = await app.inject({
        method: "PUT",
        url: "/api/v1/admin/scoring/concurrency",
        headers: adminKeyHeaders(),
        payload: {},
      });
      expect(missing.statusCode).toBe(400);

      const invalid = await app.inject({
        method: "PUT",
        url: "/api/v1/admin/scoring/concurrency",
        headers: adminKeyHeaders(),
        payload: { concurrencyCalibration: 99, expectedVersion: 1 },
      });
      expect(invalid.statusCode).toBe(400);

      const zero = await app.inject({
        method: "PUT",
        url: "/api/v1/admin/scoring/concurrency",
        headers: adminKeyHeaders(),
        payload: { concurrencyOperation: 0, expectedVersion: 1 },
      });
      expect(zero.statusCode).toBe(400);
    });

    it("rejects stale expectedVersion with 409", async () => {
      await prisma.runtimeSetting.upsert({
        where: { key: RUNTIME_SETTING_KEYS.concurrencyCalibration },
        create: {
          key: RUNTIME_SETTING_KEYS.concurrencyCalibration,
          value: 4,
          version: 1,
        },
        update: {},
      });
      await prisma.runtimeSetting.upsert({
        where: { key: RUNTIME_SETTING_KEYS.concurrencyOperation },
        create: {
          key: RUNTIME_SETTING_KEYS.concurrencyOperation,
          value: 2,
          version: 1,
        },
        update: {},
      });

      const current = await app.inject({
        method: "GET",
        url: "/api/v1/admin/scoring/concurrency",
        headers: adminKeyHeaders(),
      });
      expect(current.statusCode).toBe(200);
      const version = current.json().settingsVersion as number;

      const stale = await app.inject({
        method: "PUT",
        url: "/api/v1/admin/scoring/concurrency",
        headers: adminKeyHeaders(),
        payload: {
          concurrencyOperation: 2,
          expectedVersion: Math.max(1, version - 1),
        },
      });
      // If version is 1, version-1 becomes 1 and may succeed — force conflict via wrong high version.
      if (version === 1) {
        const conflict = await app.inject({
          method: "PUT",
          url: "/api/v1/admin/scoring/concurrency",
          headers: adminKeyHeaders(),
          payload: { concurrencyOperation: 2, expectedVersion: 999_999 },
        });
        expect(conflict.statusCode).toBe(409);
        expect(conflict.json().error.code).toBe("CONCURRENCY_VERSION_CONFLICT");
        assertNoSecrets(conflict.json());
      } else {
        expect(stale.statusCode).toBe(409);
        expect(stale.json().error.code).toBe("CONCURRENCY_VERSION_CONFLICT");
        assertNoSecrets(stale.json());
      }
    });

    it("rejects missing export body fields and unknown cohort", async () => {
      const missingBody = await app.inject({
        method: "POST",
        url: "/api/v1/admin/scoring/evidence-exports",
        headers: adminKeyHeaders(),
        payload: {},
      });
      expect(missingBody.statusCode).toBe(400);

      const unknown = await app.inject({
        method: "POST",
        url: "/api/v1/admin/scoring/evidence-exports",
        headers: adminKeyHeaders(),
        payload: { cohortId: randomUUID() },
      });
      expect(unknown.statusCode).toBe(404);
      expect(unknown.json().error.code).toBe("COHORT_NOT_FOUND");
      assertNoSecrets(unknown.json());
    });

    it("returns 404 for missing export detail", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/admin/scoring/evidence-exports/${randomUUID()}`,
        headers: adminKeyHeaders(),
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe("EXPORT_NOT_FOUND");
      assertNoSecrets(response.json());
    });

    it("returns 404 for incomplete export download", async () => {
      const cohort = await createCohort(actorUserId, seasonId);
      const exportRow = await prisma.scoringEvidenceExport.create({
        data: {
          id: randomUUID(),
          cohortId: cohort.id,
          cohortRevision: cohort.revision,
          seasonId,
          status: "RUNNING",
          progress: {},
          summary: {},
          requestedByUserId: actorUserId,
        },
      });

      const response = await app.inject({
        method: "GET",
        url: `/api/v1/admin/scoring/evidence-exports/${exportRow.id}/download`,
        headers: adminKeyHeaders(),
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe("ARCHIVE_NOT_READY");
      assertNoSecrets(response.json());
    });

    it("returns 404 for download of unknown export id", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/admin/scoring/evidence-exports/${randomUUID()}/download`,
        headers: adminKeyHeaders(),
      });
      expect(response.statusCode).toBe(404);
      expect(["ARCHIVE_NOT_READY", "EXPORT_NOT_FOUND", "ARCHIVE_MISSING"]).toContain(
        response.json().error.code,
      );
    });

    it("returns 409 when freeze has blockers (invalid freeze snapshot)", async () => {
      const cohort = await createCohort(actorUserId, seasonId);
      const exportRow = await prisma.scoringEvidenceExport.create({
        data: {
          id: randomUUID(),
          cohortId: cohort.id,
          cohortRevision: cohort.revision,
          seasonId,
          status: "COMPLETED",
          progress: {},
          summary: { freezeEligible: false },
          blockerCount: 0,
          freezeSnapshot: {},
          completedAt: new Date(),
          requestedByUserId: actorUserId,
        },
      });

      const response = await app.inject({
        method: "POST",
        url: `/api/v1/admin/scoring/evidence-exports/${exportRow.id}/freeze-bundle`,
        headers: adminKeyHeaders(),
        payload: { confirm: true },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("FREEZE_BLOCKED");
      assertNoSecrets(response.json());
    });

    it("returns 409 when freezing a non-completed export", async () => {
      const cohort = await createCohort(actorUserId, seasonId);
      const exportRow = await prisma.scoringEvidenceExport.create({
        data: {
          id: randomUUID(),
          cohortId: cohort.id,
          cohortRevision: cohort.revision,
          seasonId,
          status: "QUEUED",
          progress: {},
          summary: {},
          requestedByUserId: actorUserId,
        },
      });

      const response = await app.inject({
        method: "POST",
        url: `/api/v1/admin/scoring/evidence-exports/${exportRow.id}/freeze-bundle`,
        headers: adminKeyHeaders(),
        payload: { confirm: true },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("EXPORT_NOT_COMPLETED");
    });

    it("rejects freeze without confirm: true", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/admin/scoring/evidence-exports/${randomUUID()}/freeze-bundle`,
        headers: adminKeyHeaders(),
        payload: { confirm: false },
      });
      expect(response.statusCode).toBe(400);
    });

    it("rejects invalid / oversized pagination", async () => {
      const oversized = await app.inject({
        method: "GET",
        url: "/api/v1/admin/scoring/evidence-exports?pageSize=999",
        headers: adminKeyHeaders(),
      });
      expect(oversized.statusCode).toBe(400);

      const badPage = await app.inject({
        method: "GET",
        url: "/api/v1/admin/scoring/history?page=0",
        headers: adminKeyHeaders(),
      });
      expect(badPage.statusCode).toBe(400);

      const ok = await app.inject({
        method: "GET",
        url: "/api/v1/admin/scoring/history?page=1&pageSize=50",
        headers: adminKeyHeaders(),
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().pageSize).toBeLessThanOrEqual(50);
    });
  });

  describe("side-effect and sanitization guards", () => {
    it("GET overview does not enqueue export or refresh", async () => {
      enqueueExport.mockClear();
      enqueueRefresh.mockClear();

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/admin/scoring/overview",
        headers: adminKeyHeaders(),
      });
      expect(response.statusCode).toBe(200);
      expect(enqueueExport).not.toHaveBeenCalled();
      expect(enqueueRefresh).not.toHaveBeenCalled();
      assertNoSecrets(response.json());
    });

    it("error responses never leak DATABASE_URL or redis URLs", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/admin/scoring/evidence-exports/${randomUUID()}`,
        headers: adminKeyHeaders(),
      });
      expect(response.statusCode).toBe(404);
      assertNoSecrets(response.json());
      expect(JSON.stringify(response.json())).not.toMatch(/prisma|ECONN|stack/i);
    });
  });
});
