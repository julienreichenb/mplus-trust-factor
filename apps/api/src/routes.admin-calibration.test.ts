import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@mplus/database";
import { DEFAULT_ADMIN_PERMISSIONS, PERMISSIONS } from "./iam/permissions.js";
import { buildApp } from "./app.js";
import { createApiContainer, type ApiContainer } from "./container.js";
import {
  buildTestEnv,
  cleanupTrackedScoreModels,
  createTestPrismaClient,
  uniqueName,
} from "./test-helpers.js";
import { runCalibrationRunJob } from "@mplus/worker";
import { importCohortFromIntake } from "./services/calibration/cohort-import-cli.js";
import { resolve } from "node:path";

const { prisma, dbAvailable } = await createTestPrismaClient();
const ADMIN_KEY = "test-admin-key";
const ROOT = resolve(import.meta.dirname, "../../../");
const createdScoreModelIds: string[] = [];

afterAll(async () => {
  await cleanupTrackedScoreModels(prisma as PrismaClient, createdScoreModelIds);
  await prisma.$disconnect();
});

/** Dedicated ACTIVE reference model — never touch canonical `default` (parallel-suite safe). */
async function createOwnedActiveModel(createdByUserId: string) {
  const key = `admin-test-cal-${randomUUID().slice(0, 8)}`;
  const { createDefaultModelV6 } = await import("@mplus/scoring");
  const config = createDefaultModelV6({ key, version: 1 });
  const model = await prisma.scoreModel.create({
    data: {
      id: randomUUID(),
      key,
      version: 1,
      name: `Calibration ACTIVE ${key}`,
      description: "Phase 2 owned ACTIVE reference",
      status: "ACTIVE",
      config: config as object,
      createdByUserId,
      activatedAt: new Date(),
    },
  });
  createdScoreModelIds.push(model.id);
  return model;
}

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

describe.skipIf(!dbAvailable)("admin calibration phase 2 — active vs draft", { timeout: 90_000 }, () => {
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

  it("creates DRAFT-only models without mutating or activating the source", async () => {
    refreshEnqueue.mockClear();
    const source = await createOwnedActiveModel(actorUserId);
    const sourceConfigBefore = JSON.stringify(source.config);
    const sourceStatusBefore = source.status;
    const sourceActivatedAt = source.activatedAt?.toISOString() ?? null;

    const listed = await app.inject({
      method: "GET",
      url: "/api/v1/admin/calibration/score-models",
      headers: { "x-admin-api-key": ADMIN_KEY },
    });
    expect(listed.statusCode).toBe(200);
    expect(Array.isArray(listed.json().models)).toBe(true);
    expect(listed.json().models.some((m: { id: string }) => m.id === source.id)).toBe(true);

    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/calibration/score-models/draft",
      headers: { "x-admin-api-key": ADMIN_KEY },
      payload: {
        sourceModelId: source.id,
        name: uniqueName("cal-draft"),
        description: "Phase 2 draft — must not activate",
      },
    });
    expect(create.statusCode).toBe(201);
    const draft = create.json();
    createdScoreModelIds.push(draft.id);
    expect(draft.status).toBe("DRAFT");
    expect(draft.key).toBe(source.key);
    expect(draft.version).toBeGreaterThan(source.version);
    expect(draft.id).not.toBe(source.id);

    const sourceAfter = await prisma.scoreModel.findUniqueOrThrow({ where: { id: source.id } });
    expect(sourceAfter.status).toBe(sourceStatusBefore);
    expect(JSON.stringify(sourceAfter.config)).toBe(sourceConfigBefore);
    expect(sourceAfter.activatedAt?.toISOString() ?? null).toBe(sourceActivatedAt);

    // Activation is impossible through calibration endpoints.
    const activateViaCalibration = await app.inject({
      method: "POST",
      url: `/api/v1/admin/calibration/score-models/${draft.id}/activate`,
      headers: { "x-admin-api-key": ADMIN_KEY },
      payload: {},
    });
    expect(activateViaCalibration.statusCode).toBe(404);
    expect(refreshEnqueue).not.toHaveBeenCalled();

    const draftStill = await prisma.scoreModel.findUniqueOrThrow({ where: { id: draft.id } });
    expect(draftStill.status).toBe("DRAFT");
  });

  it("rejects ACTIVE_VERSUS_DRAFT without a distinct DRAFT evaluation model", async () => {
    refreshEnqueue.mockClear();
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/calibration/cohorts",
      headers: { "x-admin-api-key": ADMIN_KEY },
      payload: { name: uniqueName("cal-p2-mode"), seasonId, description: "mode guard" },
    });
    expect(create.statusCode).toBe(201);
    const cohortId = create.json().id;

    const runFail = await app.inject({
      method: "POST",
      url: `/api/v1/admin/calibration/cohorts/${cohortId}/runs`,
      headers: { "x-admin-api-key": ADMIN_KEY },
      payload: { mode: "ACTIVE_VERSUS_DRAFT", expectedCohortRevision: 1 },
    });
    expect(runFail.statusCode).toBe(400);
    expect(runFail.json().error.code).toBe("EVALUATION_MODEL_REQUIRED");
    expect(refreshEnqueue).not.toHaveBeenCalled();
  });

  it("evaluates active vs draft on identical frozen evidence with reproducible reports", async () => {
    refreshEnqueue.mockClear();
    calibrationEnqueue.mockClear();

    const { buildSyntheticFixtureBundle, createDefaultModelV6 } = await import("@mplus/scoring");
    const source = await createOwnedActiveModel(actorUserId);
    const sourceConfigSnapshot = JSON.stringify(source.config);

    const draftConfig = createDefaultModelV6({
      key: source.key,
      version: source.version + 100,
      weights: {
        performance: 0.45,
        survival: 0.25,
        utility: 0.2,
        experienceConsistency: 0.1,
        mythicRaid: 0,
      },
    });
    const draftCreate = await app.inject({
      method: "POST",
      url: "/api/v1/admin/calibration/score-models/draft",
      headers: { "x-admin-api-key": ADMIN_KEY },
      payload: {
        sourceModelId: source.id,
        name: uniqueName("cal-avd-draft"),
        config: draftConfig,
      },
    });
    expect(draftCreate.statusCode).toBe(201);
    const draft = draftCreate.json();
    createdScoreModelIds.push(draft.id);
    expect(draft.status).toBe("DRAFT");

    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/calibration/cohorts",
      headers: { "x-admin-api-key": ADMIN_KEY },
      payload: {
        name: uniqueName("cal-p2-avd"),
        seasonId,
        description: "frozen active-versus-draft evidence",
      },
    });
    expect(create.statusCode).toBe(201);
    const cohort = create.json();

    const fixtureBundle = buildSyntheticFixtureBundle();
    const frozenBundle = {
      ...fixtureBundle,
      mode: "active-versus-draft" as const,
      source: "fixture" as const,
      activeModel: {
        id: source.id,
        key: source.key,
        version: source.version,
        status: "ACTIVE" as const,
        isActive: true,
        config: source.config,
      },
      evaluationModel: {
        id: draft.id,
        key: draft.key,
        version: draft.version,
        status: "DRAFT" as const,
        isActive: false,
        config: draft.config,
      },
    };
    const bundleJson = JSON.stringify(frozenBundle);
    const contentHash = createHash("sha256").update(bundleJson).digest("hex");

    // Prove identical frozen evidence is shared (single evidence map for both models).
    const evidenceKeys = Object.keys(frozenBundle.evidenceByMemberId).sort();
    expect(evidenceKeys.length).toBeGreaterThan(0);
    expect(frozenBundle.activeModel.id).not.toBe(frozenBundle.evaluationModel.id);
    expect(JSON.stringify(frozenBundle.activeModel.config)).not.toBe(
      JSON.stringify(frozenBundle.evaluationModel.config),
    );

    const runId = randomUUID();
    await prisma.calibrationRun.create({
      data: {
        id: runId,
        cohortId: cohort.id,
        cohortRevision: cohort.revision,
        seasonId,
        mode: "ACTIVE_VERSUS_DRAFT",
        status: "QUEUED",
        activeModelId: source.id,
        evaluationModelId: draft.id,
        activeModelConfig: frozenBundle.activeModel.config as object,
        evaluationModelConfig: frozenBundle.evaluationModel.config as object,
        evidencePolicy: "STRICT",
        inputBundleSchemaVersion: frozenBundle.schemaVersion,
        inputBundleContentHash: contentHash,
        inputBundle: frozenBundle as object,
        inputBundleByteLength: Buffer.byteLength(bundleJson),
        snapshotIds: [],
        evidenceFingerprint: createHash("sha256")
          .update(evidenceKeys.join("|"), "utf8")
          .digest("hex"),
        algorithmVersions: {
          harness: "runCalibrationHarnessFromBundle",
          mode: "active-versus-draft",
          activeModelConfigHash: createHash("sha256")
            .update(JSON.stringify(frozenBundle.activeModel.config))
            .digest("hex"),
          evaluationModelConfigHash: createHash("sha256")
            .update(JSON.stringify(frozenBundle.evaluationModel.config))
            .digest("hex"),
        },
        createdByUserId: actorUserId,
        bullmqJobId: runId,
      },
    });

    const first = await runCalibrationRunJob(
      {
        prisma: prisma as PrismaClient,
        logger: container.logger,
        calibrationEnabled: true,
      },
      { calibrationRunId: runId, requestedAt: new Date().toISOString() },
    );
    expect(first.status).toBe("SUCCEEDED");

    const report1 = await app.inject({
      method: "GET",
      url: `/api/v1/admin/calibration/runs/${runId}/report`,
      headers: { "x-admin-api-key": ADMIN_KEY },
    });
    expect(report1.statusCode).toBe(200);
    const body1 = report1.json();
    expect(body1.summary.modelActivated).toBe(false);
    expect(body1.summary.providerCallsMade).toBe(false);
    expect(body1.summary.activeDraftComparison?.comparable).toBe(true);
    expect(body1.summary.activeDraftComparison?.aggregate?.comparableCount).toBeGreaterThan(0);
    expect(body1.summary.activeDraftComparison?.aggregate?.meanDimensionDeltas).toBeTruthy();
    expect(body1.summary.activeDraftComparison?.aggregate?.roleSlices).toBeTruthy();
    expect(body1.report.activeDraftComparison?.characters?.length).toBeGreaterThan(0);

    const hash1 = body1.contentHash as string;
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);

    // Deterministic before/after: a second run on the identical frozen bundle yields the same report hash.
    const runId2 = randomUUID();
    await prisma.calibrationRun.create({
      data: {
        id: runId2,
        cohortId: cohort.id,
        cohortRevision: cohort.revision,
        seasonId,
        mode: "ACTIVE_VERSUS_DRAFT",
        status: "QUEUED",
        activeModelId: source.id,
        evaluationModelId: draft.id,
        activeModelConfig: frozenBundle.activeModel.config as object,
        evaluationModelConfig: frozenBundle.evaluationModel.config as object,
        evidencePolicy: "STRICT",
        inputBundleSchemaVersion: frozenBundle.schemaVersion,
        inputBundleContentHash: contentHash,
        inputBundle: frozenBundle as object,
        inputBundleByteLength: Buffer.byteLength(bundleJson),
        snapshotIds: [],
        evidenceFingerprint: createHash("sha256")
          .update(evidenceKeys.join("|"), "utf8")
          .digest("hex"),
        algorithmVersions: {
          harness: "runCalibrationHarnessFromBundle",
          mode: "active-versus-draft",
        },
        createdByUserId: actorUserId,
        bullmqJobId: runId2,
      },
    });
    const twin = await runCalibrationRunJob(
      {
        prisma: prisma as PrismaClient,
        logger: container.logger,
        calibrationEnabled: true,
      },
      { calibrationRunId: runId2, requestedAt: new Date().toISOString() },
    );
    expect(twin.status).toBe("SUCCEEDED");
    const reportTwin = await app.inject({
      method: "GET",
      url: `/api/v1/admin/calibration/runs/${runId2}/report`,
      headers: { "x-admin-api-key": ADMIN_KEY },
    });
    expect(reportTwin.json().contentHash).toBe(hash1);

    // Historical reproducibility: redelivery is a no-op; report row is immutable (update: {}).
    const second = await runCalibrationRunJob(
      {
        prisma: prisma as PrismaClient,
        logger: container.logger,
        calibrationEnabled: true,
      },
      { calibrationRunId: runId, requestedAt: new Date().toISOString() },
    );
    expect(second.status).toBe("NOOP_TERMINAL");

    const report2 = await app.inject({
      method: "GET",
      url: `/api/v1/admin/calibration/runs/${runId}/report`,
      headers: { "x-admin-api-key": ADMIN_KEY },
    });
    expect(report2.json().contentHash).toBe(hash1);
    expect(JSON.stringify(report2.json().report)).toBe(JSON.stringify(body1.report));

    // Cohort edits after freeze must not rewrite the frozen input bundle.
    const patch = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/calibration/cohorts/${cohort.id}`,
      headers: { "x-admin-api-key": ADMIN_KEY },
      payload: { description: "edited after ACTIVE_VERSUS_DRAFT freeze" },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().revision).toBeGreaterThan(cohort.revision);

    const frozen = await prisma.calibrationRun.findUniqueOrThrow({ where: { id: runId } });
    expect(frozen.inputBundleContentHash).toBe(contentHash);
    expect(frozen.cohortRevision).toBe(cohort.revision);
    // Prisma JSON round-trip may reorder keys; freeze is proven by content hash + identity fields.
    const storedBundle = frozen.inputBundle as typeof frozenBundle;
    expect(storedBundle.mode).toBe("active-versus-draft");
    expect(Object.keys(storedBundle.evidenceByMemberId).sort()).toEqual(evidenceKeys);
    expect(storedBundle.activeModel.id).toBe(source.id);
    expect(storedBundle.evaluationModel.id).toBe(draft.id);
    expect(JSON.stringify(storedBundle.activeModel.config)).not.toBe(
      JSON.stringify(storedBundle.evaluationModel.config),
    );

    // Source model immutability across the full comparison path.
    const sourceAfter = await prisma.scoreModel.findUniqueOrThrow({ where: { id: source.id } });
    expect(JSON.stringify(sourceAfter.config)).toBe(sourceConfigSnapshot);
    expect(sourceAfter.status).toBe("ACTIVE");
    const draftAfter = await prisma.scoreModel.findUniqueOrThrow({ where: { id: draft.id } });
    expect(draftAfter.status).toBe("DRAFT");

    // Provider + refresh isolation: no refresh enqueue; calibration never creates IngestionJob rows.
    expect(refreshEnqueue).not.toHaveBeenCalled();
    expect(calibrationEnqueue).not.toHaveBeenCalled();
    expect(
      await prisma.ingestionJob.count({
        where: {
          OR: [
            { id: { in: [runId, runId2] } },
            { queueJobId: { in: [runId, runId2] } },
            { dedupeKey: { in: [runId, runId2] } },
          ],
        },
      }),
    ).toBe(0);
  });
});

describe("calibration queue isolation constants", () => {
  it("uses a dedicated queue name distinct from refresh-character", async () => {
    const { QUEUE_NAMES } = await import("@mplus/contracts");
    expect(QUEUE_NAMES.calibrationRun).toBe("calibration-run");
    expect(QUEUE_NAMES.calibrationRun).not.toBe(QUEUE_NAMES.refreshCharacter);
  });
});
