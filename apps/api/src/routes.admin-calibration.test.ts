import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@mplus/database";
import { DEFAULT_ADMIN_PERMISSIONS, PERMISSIONS } from "./iam/permissions.js";
import { buildApp } from "./app.js";
import { createApiContainer, type ApiContainer } from "./container.js";
import { buildTestEnv, createTestPrismaClient, uniqueName } from "./test-helpers.js";
import { runCalibrationRunJob } from "@mplus/worker";
import { importCohortFromIntake } from "./services/calibration/cohort-import-cli.js";
import { resolve } from "node:path";

const { prisma, dbAvailable } = await createTestPrismaClient();
const ADMIN_KEY = "test-admin-key";
const ROOT = resolve(import.meta.dirname, "../../../");

afterAll(async () => {
  await prisma.$disconnect();
});

function stubProducers(enqueueSpy?: ReturnType<typeof vi.fn>) {
  const ok = async () => ({
    jobId: randomUUID(),
    dedupeKey: `stub-${randomUUID()}`,
    reused: false,
    enqueued: true,
  });
  const enqueueCalibrationRun =
    enqueueSpy ??
    (async (input: { calibrationRunId: string }) => ({
      jobId: input.calibrationRunId,
      dedupeKey: input.calibrationRunId,
      reused: false,
      enqueued: true,
    }));
  return {
    enqueueRefreshCharacter: ok,
    enqueueAnalyzeRun: ok,
    enqueueRecalculateScore: ok,
    enqueueGenerateAddonExport: ok,
    enqueueDiscoverOwnedCharacters: ok,
    enqueueBulkCharacterProcessing: ok,
    enqueueCalibrationRun,
    getRefreshCharacterQueue: () => null,
    getCalibrationRunQueue: () => null,
    close: async () => undefined,
  };
}

async function ensureActorUser(p: PrismaClient): Promise<string> {
  const existing = await p.user.findFirst({ orderBy: { createdAt: "asc" } });
  if (existing) return existing.id;
  const id = randomUUID();
  await p.user.create({
    data: {
      id,
      authProvider: "test",
      externalSubject: `calibration-${id}`,
      displayName: "Calibration Test",
    },
  });
  return id;
}

async function ensureSeason(p: PrismaClient): Promise<string> {
  const existing = await p.season.findFirst({ orderBy: { createdAt: "asc" } });
  if (existing) return existing.id;
  const region = await p.region.findFirst();
  if (!region) throw new Error("No region for season fixture");
  const id = randomUUID();
  await p.season.create({
    data: {
      id,
      slug: `cal-test-${id.slice(0, 8)}`,
      name: "Calibration Test Season",
      regionId: region.id,
    },
  });
  return id;
}

describe.skipIf(!dbAvailable)("admin calibration platform", { timeout: 60_000 }, () => {
  let app: FastifyInstance;
  let container: ApiContainer;
  let seasonId: string;
  let actorUserId: string;
  const refreshEnqueue = vi.fn(async () => ({
    jobId: randomUUID(),
    dedupeKey: randomUUID(),
    reused: false,
    enqueued: true,
  }));
  const calibrationEnqueue = vi.fn(async (input: { calibrationRunId: string }) => ({
    jobId: input.calibrationRunId,
    dedupeKey: input.calibrationRunId,
    reused: false,
    enqueued: true,
  }));

  beforeAll(async () => {
    seasonId = await ensureSeason(prisma as PrismaClient);
    actorUserId = await ensureActorUser(prisma as PrismaClient);
    const env = buildTestEnv({
      ADMIN_API_KEY: ADMIN_KEY,
      ADMIN_CALIBRATION_ENABLED: "true",
      ADMIN_API_KEY_EMERGENCY_FALLBACK: "true",
    });
    const producers = stubProducers(calibrationEnqueue);
    producers.enqueueRefreshCharacter = refreshEnqueue;
    container = createApiContainer(env, {
      workerOverrides: { prisma: prisma as PrismaClient },
      producers: producers as never,
    });
    app = await buildApp({ env, container });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("provisions admin.calibration.manage on the admin role defaults", () => {
    expect(PERMISSIONS.ADMIN_CALIBRATION_MANAGE).toBe("admin.calibration.manage");
    expect(DEFAULT_ADMIN_PERMISSIONS).toContain(PERMISSIONS.ADMIN_CALIBRATION_MANAGE);
  });

  it("fail-closes when ADMIN_CALIBRATION_ENABLED=false", async () => {
    const disabledEnv = buildTestEnv({
      ADMIN_API_KEY: ADMIN_KEY,
      ADMIN_CALIBRATION_ENABLED: "false",
      ADMIN_API_KEY_EMERGENCY_FALLBACK: "true",
    });
    const disabledContainer = createApiContainer(disabledEnv, {
      workerOverrides: { prisma: prisma as PrismaClient },
      producers: stubProducers() as never,
    });
    const disabledApp = await buildApp({ env: disabledEnv, container: disabledContainer });
    await disabledApp.ready();
    const response = await disabledApp.inject({
      method: "GET",
      url: "/api/v1/admin/calibration/cohorts",
      headers: { "x-admin-api-key": ADMIN_KEY },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("ADMIN_CALIBRATION_DISABLED");
    await disabledApp.close();
  });

  it("rejects unauthenticated access", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/admin/calibration/cohorts" });
    expect(response.statusCode).toBe(401);
  });

  it("supports cohort CRUD, revision bumps, archive, preflight, run freeze, cancel, report immutability", async () => {
    refreshEnqueue.mockClear();
    calibrationEnqueue.mockClear();

    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/calibration/cohorts",
      headers: { "x-admin-api-key": ADMIN_KEY },
      payload: {
        name: uniqueName("cal-cohort"),
        seasonId,
        description: "phase1 test",
      },
    });
    expect(create.statusCode).toBe(201);
    const cohort = create.json();
    expect(cohort.revision).toBe(1);
    expect(cohort.createdByUserId).toBeTruthy();

    const add = await app.inject({
      method: "POST",
      url: `/api/v1/admin/calibration/cohorts/${cohort.id}/members`,
      headers: { "x-admin-api-key": ADMIN_KEY },
      payload: {
        region: "EU",
        realmSlug: "hyjal",
        characterName: uniqueName("CalChar"),
        expectedLabel: "GOOD",
        rationale: "expert judgement — not from score",
        providedRole: "DPS",
      },
    });
    expect(add.statusCode).toBe(201);

    const afterMember = await app.inject({
      method: "GET",
      url: `/api/v1/admin/calibration/cohorts/${cohort.id}`,
      headers: { "x-admin-api-key": ADMIN_KEY },
    });
    expect(afterMember.json().revision).toBe(2);

    const preflight = await app.inject({
      method: "POST",
      url: `/api/v1/admin/calibration/cohorts/${cohort.id}/preflight`,
      headers: { "x-admin-api-key": ADMIN_KEY },
      payload: { mode: "PERSISTED_SNAPSHOT_ONLY" },
    });
    expect(preflight.statusCode).toBe(200);
    const pf = preflight.json();
    expect(pf.members[0].expectedLabel).toBe("GOOD");
    expect(pf.members[0].missingEvidence).toBe(true);
    expect(refreshEnqueue).not.toHaveBeenCalled();

    // Without snapshots, STRICT run creation must fail closed — never invent labels from scores.
    const runFail = await app.inject({
      method: "POST",
      url: `/api/v1/admin/calibration/cohorts/${cohort.id}/runs`,
      headers: { "x-admin-api-key": ADMIN_KEY },
      payload: { mode: "PERSISTED_SNAPSHOT_ONLY", expectedCohortRevision: 2 },
    });
    expect(runFail.statusCode).toBe(400);
    expect(["CHARACTER_NOT_FOUND", "SNAPSHOT_MISSING", "EMPTY_CALIBRATION_COHORT"]).toContain(
      runFail.json().error.code,
    );
    expect(refreshEnqueue).not.toHaveBeenCalled();

    // Create a QUEUED run row directly to exercise cancel + processor no-op paths without snapshots.
    const runId = randomUUID();
    const tinyBundle = {
      schemaVersion: "1.0.0",
      manifest: {
        schemaVersion: "1.0.0",
        cohortId: cohort.id,
        description: "tiny",
        createdAt: new Date().toISOString(),
        members: [],
      },
      evidenceByMemberId: {},
      generatedAt: new Date().toISOString(),
      source: "persisted-export",
      mode: "persisted-snapshot-only",
    };
    const bundleJson = JSON.stringify(tinyBundle);
    await prisma.calibrationRun.create({
      data: {
        id: runId,
        cohortId: cohort.id,
        cohortRevision: 2,
        seasonId,
        mode: "PERSISTED_SNAPSHOT_ONLY",
        status: "QUEUED",
        evidencePolicy: "STRICT",
        inputBundleSchemaVersion: "1.0.0",
        inputBundleContentHash: createHash("sha256").update(bundleJson).digest("hex"),
        inputBundle: tinyBundle,
        inputBundleByteLength: Buffer.byteLength(bundleJson),
        snapshotIds: [],
        createdByUserId: actorUserId,
        bullmqJobId: runId,
      },
    });

    const cancel = await app.inject({
      method: "POST",
      url: `/api/v1/admin/calibration/runs/${runId}/cancel`,
      headers: { "x-admin-api-key": ADMIN_KEY },
    });
    expect(cancel.statusCode).toBe(200);
    expect(cancel.json().status).toBe("CANCELLED");

    const redelivery = await runCalibrationRunJob(
      {
        prisma: prisma as PrismaClient,
        logger: container.logger,
        calibrationEnabled: true,
      },
      { calibrationRunId: runId, requestedAt: new Date().toISOString() },
    );
    expect(redelivery.status).toBe("NOOP_TERMINAL");

    const patchAfter = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/calibration/cohorts/${cohort.id}`,
      headers: { "x-admin-api-key": ADMIN_KEY },
      payload: { description: "edited after freeze attempt" },
    });
    expect(patchAfter.statusCode).toBe(200);
    expect(patchAfter.json().revision).toBeGreaterThan(2);

    const frozen = await prisma.calibrationRun.findUniqueOrThrow({ where: { id: runId } });
    expect(frozen.cohortRevision).toBe(2);
    expect(frozen.inputBundleContentHash).toBe(
      createHash("sha256").update(bundleJson).digest("hex"),
    );

    const archive = await app.inject({
      method: "POST",
      url: `/api/v1/admin/calibration/cohorts/${cohort.id}/archive`,
      headers: { "x-admin-api-key": ADMIN_KEY },
    });
    expect(archive.statusCode).toBe(200);
    expect(archive.json().status).toBe("ARCHIVED");

    const memberAfterArchive = await app.inject({
      method: "POST",
      url: `/api/v1/admin/calibration/cohorts/${cohort.id}/members`,
      headers: { "x-admin-api-key": ADMIN_KEY },
      payload: {
        region: "EU",
        realmSlug: "hyjal",
        characterName: "Nope",
        expectedLabel: "WEAK",
        rationale: "should fail",
      },
    });
    expect(memberAfterArchive.statusCode).toBe(409);
    expect(refreshEnqueue).not.toHaveBeenCalled();
  });

  it("imports Agent 11 intake idempotently without providers", async () => {
    const intakePath = resolve(ROOT, "doc/scoring/cohorts/agent11-2026-08-01/intake.v1.json");
    const exclusionsPath = resolve(ROOT, "doc/scoring/cohorts/agent11-2026-08-01/exclusions.v1.json");
    const first = await importCohortFromIntake({
      prisma: prisma as PrismaClient,
      intakePath,
      exclusionsPath,
      seasonIdOrSlug: seasonId,
      createdByUserId: actorUserId,
    });
    expect(first.memberCount).toBe(41);
    const second = await importCohortFromIntake({
      prisma: prisma as PrismaClient,
      intakePath,
      exclusionsPath,
      seasonIdOrSlug: seasonId,
      createdByUserId: actorUserId,
    });
    expect(second.created).toBe(false);
    expect(second.cohortId).toBe(first.cohortId);
    expect(second.memberCount).toBe(41);

    const members = await prisma.calibrationCohortMember.findMany({
      where: { cohortId: first.cohortId },
    });
    expect(members).toHaveLength(41);
    const myzouth = members.find((m) => m.externalMemberKey?.includes("myzouth"));
    expect(myzouth?.included).toBe(false);
    expect(myzouth?.exclusionCode).toBe("MYZOUTH_BOOTSTRAP_DEFERRED");
    expect(members.every((m) => m.expectedLabel.length > 0)).toBe(true);
    expect(refreshEnqueue).not.toHaveBeenCalled();
  });
});

describe("calibration queue isolation constants", () => {
  it("uses a dedicated queue name distinct from refresh-character", async () => {
    const { QUEUE_NAMES } = await import("@mplus/contracts");
    expect(QUEUE_NAMES.calibrationRun).toBe("calibration-run");
    expect(QUEUE_NAMES.calibrationRun).not.toBe(QUEUE_NAMES.refreshCharacter);
  });
});
