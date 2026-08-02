import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@mplus/database";
import type { QueueProducers } from "@mplus/worker";
import { buildApp } from "./app.js";
import { createApiContainer, type ApiContainer } from "./container.js";
import {
  buildScoreModelConfig,
  buildTestEnv,
  cleanupTrackedScoreModels,
  createTestPrismaClient,
} from "./test-helpers.js";

const { prisma, dbAvailable } = await createTestPrismaClient();
const ADMIN_KEY = "test-admin-key-lifecycle";
const createdScoreModelIds: string[] = [];

afterAll(async () => {
  await cleanupTrackedScoreModels(prisma, createdScoreModelIds);
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
    enqueueAnalyzeEvidenceSlot: ok,
    enqueueFinalizeEvidenceBatch: ok,
    getRefreshCharacterQueue: () => null,
    getCalibrationRunQueue: () => null,
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
    const model = response.json() as { id: string; key: string; version: number; status: string };
    createdScoreModelIds.push(model.id);
    return model;
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
    expect(String(body.note ?? "")).not.toContain("Fell back to persisted-snapshot-only");
    expect(body.gradeDistribution).toBeTypeOf("object");
    expect(body.outliers).toBeDefined();
    expect(body.confidenceVersusCoverage).toBeDefined();
    expect(body.cohortId).toBeTruthy();
    if (body.mode === "persisted-snapshot-only") {
      expect(body.degradedReason).toMatch(
        /^(NO_PUBLIC_SNAPSHOTS|NO_REPLAYABLE_EVIDENCE|NO_ACTIVE_MODEL|EVALUATION_NOT_DRAFT)$/,
      );
    } else {
      expect(body.mode).toBe("active-versus-draft");
      expect(body.degradedReason == null).toBe(true);
      expect(body.activeDraftComparison).toBeTruthy();
    }
    if (body.sampleSize === 0) {
      expect(body.meanScore).toBe(0);
    }
  });

  it("rejects backtest of an invalid draft with a clear validation error", async () => {
    const key = `life-bad-${randomUUID().slice(0, 8)}`;
    const draft = await createDraft(key);
    await prisma.scoreModel.update({
      where: { id: draft.id },
      data: {
        config: {
          ...buildScoreModelConfig(key),
          weights: {
            performance: 0.9,
            survival: 0.27,
            utility: 0.23,
            experienceConsistency: 0.13,
            mythicRaid: 0.05,
          },
        },
      },
    });
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/score-models/${draft.id}/backtest`,
      headers: adminHeaders(),
      payload: {},
    });
    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error.code).toBe("SCORE_MODEL_INVALID");
    expect(String(body.error.message)).toMatch(/weight/i);
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

  it("accepts a seed-shaped v6 persisted config on PUT without key/version or mock-only fields", async () => {
    const key = `life-v6-${randomUUID().slice(0, 8)}`;
    const draft = await createDraft(key);
    const seededV6Config = {
      weights: {
        performance: 0.35,
        survival: 0.3,
        utility: 0.25,
        experienceConsistency: 0.1,
        mythicRaid: 0,
      },
      authenticityBlend: { skillWeight: 0.6, authenticityWeight: 0.4 },
      confidenceNeutralScore: 50,
      gradeThresholds: { S: 90, A: 80, B: 65, C: 50 },
      minConfidenceForGrade: 0.35,
      metricWeights: {
        PERFORMANCE: [
          { metricKey: "performance.current_season_peak", weight: 0.5525 },
          { metricKey: "performance.current_season_consistency", weight: 0.2975 },
          { metricKey: "performance.historical_best_average", weight: 0.15 },
        ],
        SURVIVAL: [
          { metricKey: "survival.outcome", weight: 0.55 },
          { metricKey: "survival.defensive_response", weight: 0.3 },
          { metricKey: "survival.emergency_recovery", weight: 0.15 },
        ],
        UTILITY: [{ metricKey: "utility.observed_contribution", weight: 1 }],
        EXPERIENCE: [
          { metricKey: "experience.dungeon_breadth", weight: 0.3 },
          { metricKey: "experience.key_band_breadth", weight: 0.22 },
          { metricKey: "experience.participation_depth", weight: 0.2 },
          { metricKey: "experience.historical_seasons", weight: 0.18 },
          { metricKey: "experience.activity_recency", weight: 0.1 },
        ],
        RAID: [
          { metricKey: "raid.mythic_progression", weight: 0.6 },
          { metricKey: "raid.mythic_parses", weight: 0.4 },
        ],
      },
      eligibility: { minKnownRuns: 20, baselineKeyLevel: 10, topPopulationPercent: 25 },
      utilityPublicationEligibility: {
        minAnalyzedRuns: 3,
        minConfidence: 0.45,
        minEvidenceCoverage: 0.5,
        minObservedDomains: 2,
      },
      overallFormula: "WEIGHTED_DIMENSIONS",
    };

    const put = await app.inject({
      method: "PUT",
      url: `/api/v1/admin/score-models/${draft.id}`,
      headers: adminHeaders(),
      payload: { config: seededV6Config },
    });
    expect(put.statusCode).toBe(200);
    const body = put.json() as { config: Record<string, unknown> };
    expect(body.config.metricWeights).toEqual(seededV6Config.metricWeights);
    expect(body.config).not.toHaveProperty("nestedMetricWeights");
    expect(body.config.overallFormula).toBe("WEIGHTED_DIMENSIONS");

    const validated = await app.inject({
      method: "POST",
      url: `/api/v1/admin/score-models/${draft.id}/validate`,
      headers: adminHeaders(),
      payload: {},
    });
    expect(validated.statusCode).toBe(200);
    expect(validated.json()).toMatchObject({ valid: true, errors: [] });
  });

  describe("DELETE /api/v1/admin/score-models/:id", () => {
    it("returns 404 for a missing model", async () => {
      const response = await app.inject({
        method: "DELETE",
        url: `/api/v1/admin/score-models/${randomUUID()}`,
        headers: adminHeaders(),
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe("SCORE_MODEL_NOT_FOUND");
    });

    it("refuses to delete an ACTIVE model", async () => {
      const key = `life-del-act-${randomUUID().slice(0, 8)}`;
      const draft = await createDraft(key);
      const activate = await app.inject({
        method: "POST",
        url: `/api/v1/admin/score-models/${draft.id}/activate`,
        headers: adminHeaders(),
        payload: { confirm: true },
      });
      expect(activate.statusCode).toBe(200);

      const del = await app.inject({
        method: "DELETE",
        url: `/api/v1/admin/score-models/${draft.id}`,
        headers: adminHeaders(),
      });
      expect(del.statusCode).toBe(409);
      expect(del.json().error.code).toBe("SCORE_MODEL_NOT_DELETABLE");

      const stillThere = await prisma.scoreModel.findUnique({ where: { id: draft.id } });
      expect(stillThere).not.toBeNull();
    });

    it("refuses to delete an ARCHIVED model", async () => {
      const key = `life-del-arch-${randomUUID().slice(0, 8)}`;
      const first = await createDraft(key);
      await app.inject({
        method: "POST",
        url: `/api/v1/admin/score-models/${first.id}/activate`,
        headers: adminHeaders(),
        payload: { confirm: true },
      });
      const second = await createDraft(key);
      await app.inject({
        method: "POST",
        url: `/api/v1/admin/score-models/${second.id}/activate`,
        headers: adminHeaders(),
        payload: { confirm: true, expectedPreviousActiveId: first.id },
      });

      const archived = await prisma.scoreModel.findUnique({ where: { id: first.id } });
      expect(archived?.status).toBe("ARCHIVED");

      const del = await app.inject({
        method: "DELETE",
        url: `/api/v1/admin/score-models/${first.id}`,
        headers: adminHeaders(),
      });
      expect(del.statusCode).toBe(409);
      expect(del.json().error.code).toBe("SCORE_MODEL_NOT_DELETABLE");
    });

    it("deletes an unused DRAFT and writes an audit event", async () => {
      const key = `life-del-draft-${randomUUID().slice(0, 8)}`;
      const draft = await createDraft(key);

      const del = await app.inject({
        method: "DELETE",
        url: `/api/v1/admin/score-models/${draft.id}`,
        headers: adminHeaders(),
      });
      expect(del.statusCode).toBe(200);
      const body = del.json();
      expect(body).toMatchObject({ id: draft.id, key, version: draft.version, status: "DRAFT" });

      const gone = await prisma.scoreModel.findUnique({ where: { id: draft.id } });
      expect(gone).toBeNull();

      const audits = await prisma.auditEvent.findMany({
        where: { action: "admin.score_models.delete", resourceId: draft.id },
      });
      expect(audits.length).toBeGreaterThanOrEqual(1);
    });

    it("returns 409 SCORE_MODEL_DRAFT_IN_USE with safe dependency counts when durable history references the draft", async () => {
      const key = `life-del-inuse-${randomUUID().slice(0, 8)}`;
      const draft = await createDraft(key);

      await prisma.bulkOperation.create({
        data: {
          mode: "RECALCULATE_ONLY",
          logicalKey: `test-in-use-${randomUUID()}`,
          batchSize: 10,
          scoreModelId: draft.id,
        },
      });

      const del = await app.inject({
        method: "DELETE",
        url: `/api/v1/admin/score-models/${draft.id}`,
        headers: adminHeaders(),
      });
      expect(del.statusCode).toBe(409);
      const body = del.json();
      expect(body.error.code).toBe("SCORE_MODEL_DRAFT_IN_USE");
      expect(body.error.details.counts.bulkOperations).toBeGreaterThanOrEqual(1);

      const stillThere = await prisma.scoreModel.findUnique({ where: { id: draft.id } });
      expect(stillThere).not.toBeNull();
    });
  });
});
