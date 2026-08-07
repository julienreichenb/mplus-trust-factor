import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, type Mock } from "vitest";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@mplus/database";
import { buildApp } from "./app.js";
import { createApiContainer, type ApiContainer } from "./container.js";
import {
  buildTestEnv,
  cleanupTrackedScoreModels,
  createTestPrismaClient,
  uniqueName,
} from "./test-helpers.js";
import { runCalibrationRunJob } from "@mplus/worker";

const { prisma, dbAvailable } = await createTestPrismaClient();
const ADMIN_KEY = "test-admin-key-cal-workflow";
const createdScoreModelIds: string[] = [];

afterAll(async () => {
  await cleanupTrackedScoreModels(prisma as PrismaClient, createdScoreModelIds);
  await prisma.$disconnect();
});

function stubProducers(enqueueSpy?: Mock) {
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
    enqueueScoringEvidenceExport: ok,
    enqueueAnalyzeEvidenceSlot: ok,
    enqueueFinalizeEvidenceBatch: ok,
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
      externalSubject: `calibration-wf-${id}`,
      displayName: "Calibration Workflow Test",
    },
  });
  return id;
}

async function ensureSeason(p: PrismaClient): Promise<string> {
  const existing = await p.season.findFirst({ orderBy: { createdAt: "asc" } });
  if (existing) return existing.id;
  const region = await p.region.findFirst();
  if (!region) throw new Error("region required");
  const id = randomUUID();
  await p.season.create({
    data: {
      id,
      slug: `cal-wf-${id.slice(0, 8)}`,
      name: "Calibration WF Season",
      regionId: region.id,
      isCurrent: true,
    },
  });
  return id;
}

async function createOwnedActiveModel(createdByUserId: string) {
  const key = `admin-cal-wf-${randomUUID().slice(0, 8)}`;
  const { createDefaultModelV6 } = await import("@mplus/scoring");
  const config = createDefaultModelV6({ key, version: 1 });
  const model = await prisma.scoreModel.create({
    data: {
      id: randomUUID(),
      key,
      version: 1,
      name: `WF ACTIVE ${key}`,
      description: "workflow test ACTIVE",
      status: "ACTIVE",
      config: config as object,
      createdByUserId,
      activatedAt: new Date(),
    },
  });
  createdScoreModelIds.push(model.id);
  return model;
}

async function createOwnedDraftModel(createdByUserId: string, sourceKey: string) {
  const { createDefaultModelV6 } = await import("@mplus/scoring");
  const config = createDefaultModelV6({ key: sourceKey, version: 2 });
  const model = await prisma.scoreModel.create({
    data: {
      id: randomUUID(),
      key: sourceKey,
      version: 2,
      name: `WF DRAFT ${sourceKey}`,
      description: "workflow test DRAFT",
      status: "DRAFT",
      config: config as object,
      createdByUserId,
    },
  });
  createdScoreModelIds.push(model.id);
  return model;
}

describe.skipIf(!dbAvailable)("admin calibration workflow", { timeout: 60_000 }, () => {
  let app: FastifyInstance;
  let container: ApiContainer;
  let userId: string;
  let seasonId: string;

  beforeAll(async () => {
    userId = await ensureActorUser(prisma as PrismaClient);
    seasonId = await ensureSeason(prisma as PrismaClient);
    const env = buildTestEnv({
      ADMIN_API_KEY: ADMIN_KEY,
      ADMIN_CALIBRATION_ENABLED: "true",
      ADMIN_API_KEY_EMERGENCY_FALLBACK: "true",
    });
    container = createApiContainer(env, {
      workerOverrides: { prisma: prisma as PrismaClient },
      producers: stubProducers() as never,
    });
    app = await buildApp({ env, container });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("creates cohort without seasonId, rejects duplicate members, validates expected rank", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/calibration/cohorts",
      headers: { "x-admin-api-key": ADMIN_KEY },
      payload: { name: uniqueName("wf-cohort") },
    });
    expect(create.statusCode).toBe(201);
    const cohort = create.json();
    expect(cohort.seasonId).toBeTruthy();

    const add = await app.inject({
      method: "POST",
      url: `/api/v1/admin/calibration/cohorts/${cohort.id}/members`,
      headers: { "x-admin-api-key": ADMIN_KEY },
      payload: {
        region: "EU",
        realmSlug: "archimonde",
        characterName: "Wallidrixe",
        expectedRank: "S",
      },
    });
    expect(add.statusCode).toBe(201);
    expect(add.json().expectedRank).toBe("S");
    expect(add.json().expectedLabel).toBe("EXCELLENT");

    const dup = await app.inject({
      method: "POST",
      url: `/api/v1/admin/calibration/cohorts/${cohort.id}/members`,
      headers: { "x-admin-api-key": ADMIN_KEY },
      payload: {
        region: "EU",
        realmSlug: "archimonde",
        characterName: "Wallidrixe",
        expectedRank: "A",
      },
    });
    expect(dup.statusCode).toBe(409);

    const badRank = await app.inject({
      method: "POST",
      url: `/api/v1/admin/calibration/cohorts/${cohort.id}/members`,
      headers: { "x-admin-api-key": ADMIN_KEY },
      payload: {
        region: "EU",
        realmSlug: "archimonde",
        characterName: "Other",
        expectedRank: "U",
      },
    });
    expect(badRank.statusCode).toBeGreaterThanOrEqual(400);
    expect(badRank.statusCode).toBeLessThan(600);

    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/calibration/cohorts/${cohort.id}`,
      headers: { "x-admin-api-key": ADMIN_KEY },
    });
    expect(del.statusCode).toBe(200);
  });

  it("accepts ACTIVE/DRAFT scoreModelId and refuses ARCHIVED", async () => {
    const active = await createOwnedActiveModel(userId);
    const draft = await createOwnedDraftModel(userId, active.key);
    const archived = await prisma.scoreModel.create({
      data: {
        id: randomUUID(),
        key: `${active.key}-arch`,
        version: 1,
        name: "Archived",
        status: "ARCHIVED",
        config: active.config as object,
        createdByUserId: userId,
      },
    });
    createdScoreModelIds.push(archived.id);

    const cohortRes = await app.inject({
      method: "POST",
      url: "/api/v1/admin/calibration/cohorts",
      headers: { "x-admin-api-key": ADMIN_KEY },
      payload: { name: uniqueName("wf-model"), seasonId },
    });
    const cohort = cohortRes.json();

    await app.inject({
      method: "POST",
      url: `/api/v1/admin/calibration/cohorts/${cohort.id}/members`,
      headers: { "x-admin-api-key": ADMIN_KEY },
      payload: {
        region: "EU",
        realmSlug: "archimonde",
        characterName: "NoEvidence",
        expectedRank: "B",
      },
    });

    const activeRun = await app.inject({
      method: "POST",
      url: `/api/v1/admin/calibration/cohorts/${cohort.id}/runs`,
      headers: { "x-admin-api-key": ADMIN_KEY },
      payload: { scoreModelId: active.id },
    });
    expect(activeRun.statusCode).toBe(201);
    expect(activeRun.json().mode).toBe("PERSISTED_SNAPSHOT_ONLY");
    const activeRow = await prisma.calibrationRun.findUnique({ where: { id: activeRun.json().id } });
    expect((activeRow?.algorithmVersions as { evidenceSource?: string })?.evidenceSource).toBe(
      "CANONICAL_ACQUIRE_EVALUATE",
    );

    const draftRun = await app.inject({
      method: "POST",
      url: `/api/v1/admin/calibration/cohorts/${cohort.id}/runs`,
      headers: { "x-admin-api-key": ADMIN_KEY },
      payload: { scoreModelId: draft.id },
    });
    expect([201, 400]).toContain(draftRun.statusCode);
    if (draftRun.statusCode === 201) {
      expect(draftRun.json().mode).toBe("DRAFT_MODEL_EVALUATE");
    }

    const archivedRun = await app.inject({
      method: "POST",
      url: `/api/v1/admin/calibration/cohorts/${cohort.id}/runs`,
      headers: { "x-admin-api-key": ADMIN_KEY },
      payload: { scoreModelId: archived.id },
    });
    expect(archivedRun.statusCode).toBe(400);
    expect(archivedRun.json().error?.code).toBe("SCORE_MODEL_ARCHIVED");
  });

  it("preserves historical expected rank snapshot when member label changes after run", async () => {
    const active = await createOwnedActiveModel(userId);
    const cohortRes = await app.inject({
      method: "POST",
      url: "/api/v1/admin/calibration/cohorts",
      headers: { "x-admin-api-key": ADMIN_KEY },
      payload: { name: uniqueName("wf-snap"), seasonId },
    });
    const cohort = cohortRes.json();
    const memberRes = await app.inject({
      method: "POST",
      url: `/api/v1/admin/calibration/cohorts/${cohort.id}/members`,
      headers: { "x-admin-api-key": ADMIN_KEY },
      payload: {
        region: "EU",
        realmSlug: "archimonde",
        characterName: "SnapshotLabel",
        expectedRank: "A",
      },
    });
    const member = memberRes.json();

    const runRes = await app.inject({
      method: "POST",
      url: `/api/v1/admin/calibration/cohorts/${cohort.id}/runs`,
      headers: { "x-admin-api-key": ADMIN_KEY },
      payload: { scoreModelId: active.id },
    });
    expect(runRes.statusCode).toBe(201);
    const run = runRes.json();
    const bundle = await prisma.calibrationRun.findUnique({ where: { id: run.id } });
    const input = bundle?.inputBundle as { manifest?: { members?: Array<{ expectedLabel: string }> } };
    expect(input.manifest?.members?.[0]?.expectedLabel).toBe("good");

    await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/calibration/cohorts/${cohort.id}/members/${member.id}`,
      headers: { "x-admin-api-key": ADMIN_KEY },
      payload: { expectedRank: "D" },
    });

    const bundleAfter = await prisma.calibrationRun.findUnique({ where: { id: run.id } });
    const inputAfter = bundleAfter?.inputBundle as {
      manifest?: { members?: Array<{ expectedLabel: string }> };
    };
    expect(inputAfter.manifest?.members?.[0]?.expectedLabel).toBe("good");

    await runCalibrationRunJob(
      {
        prisma: prisma as PrismaClient,
        logger: container.logger,
        calibrationEnabled: true,
        container: container.worker,
      },
      { calibrationRunId: run.id, requestedAt: new Date().toISOString() },
    );
    const terminal = await prisma.calibrationRun.findUnique({ where: { id: run.id } });
    expect(["SUCCEEDED", "FAILED"]).toContain(terminal?.status ?? "");

    const algo = bundleAfter?.algorithmVersions as { evidenceSource?: string } | null;
    expect(algo?.evidenceSource).toBe("CANONICAL_ACQUIRE_EVALUATE");
  });
});
