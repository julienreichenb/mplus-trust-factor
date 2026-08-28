import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@mplus/database";
import type { QueueProducers } from "@mplus/worker";
import { buildApp } from "./app.js";
import { createApiContainer, type ApiContainer } from "./container.js";
import { buildTestEnv, createTestPrismaClient, uniqueName } from "./test-helpers.js";
import { ensureIamSeed } from "./iam/seed.js";

const { prisma, dbAvailable } = await createTestPrismaClient();
const ADMIN_KEY = "test-admin-key-score-ctx";

afterAll(async () => {
  await prisma.$disconnect();
});

function stubProducers(enqueueBulk: ReturnType<typeof vi.fn>): QueueProducers {
  const ok = async () => ({
    jobId: randomUUID(),
    dedupeKey: `stub-${randomUUID()}`,
    reused: false,
    enqueued: true,
  });
  const forbidden = vi.fn(async () => {
    throw new Error("provider/refresh path must not run from score-context admin");
  });
  return {
    enqueueRefreshCharacter: forbidden,
    enqueueAnalyzeRun: forbidden,
    enqueueRecalculateScore: ok,
    enqueueGenerateAddonExport: ok,
    enqueueDiscoverOwnedCharacters: ok,
    enqueueBulkCharacterProcessing: enqueueBulk,
    enqueueCalibrationRun: ok,
    enqueueScoringEvidenceExport: ok,
    enqueueAnalyzeEvidenceSlot: ok,
    enqueueFinalizeEvidenceBatch: ok,
    enqueueKeyDistributionRefresh: ok,
    enqueueScoringSeasonDataSync: ok,
    registerScoringSeasonDataSyncSchedule: async () => undefined,
    getRefreshCharacterQueue: () => null,
    getCalibrationRunQueue: () => null,
    close: async () => undefined,
  } as QueueProducers;
}

describe.skipIf(!dbAvailable)("admin score context HTTP", { timeout: 60_000 }, () => {
  let app: FastifyInstance;
  let container: ApiContainer;
  let seasonA: string;
  let seasonB: string;
  const enqueueBulk = vi.fn(async (job: { bulkOperationId: string }) => ({
    jobId: job.bulkOperationId,
    dedupeKey: job.bulkOperationId,
    reused: false,
    enqueued: true,
  }));

  beforeAll(async () => {
    const env = buildTestEnv({
      ADMIN_API_KEY: ADMIN_KEY,
      ADMIN_API_KEY_EMERGENCY_FALLBACK: "true",
    });
    const region = await prisma.region.findFirst();
    if (!region) throw new Error("Need a region");
    const a = await prisma.season.create({
      data: {
        id: randomUUID(),
        slug: uniqueName("ctx-a"),
        name: "Context Season A",
        regionId: region.id,
        blizzardSeasonId: 87101,
      },
    });
    const b = await prisma.season.create({
      data: {
        id: randomUUID(),
        slug: uniqueName("ctx-b"),
        name: "Context Season B",
        regionId: region.id,
        blizzardSeasonId: 87102,
        isCurrent: true,
      },
    });
    seasonA = a.id;
    seasonB = b.id;
    await ensureIamSeed(prisma as PrismaClient);
    container = createApiContainer(env, {
      workerOverrides: { prisma: prisma as PrismaClient },
      producers: stubProducers(enqueueBulk),
    });
    app = await buildApp({ env, container });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const headers = { "x-admin-api-key": ADMIN_KEY };

  it("rejects unauthenticated reads and writes", async () => {
    const read = await app.inject({ method: "GET", url: `/api/v1/admin/seasons/${seasonA}/score-context` });
    expect(read.statusCode).toBe(401);
    const write = await app.inject({
      method: "POST",
      url: `/api/v1/admin/seasons/${seasonA}/score-context/draft`,
    });
    expect(write.statusCode).toBe(401);
  });

  it("does not expose a generic all-seasons list", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/admin/seasons",
      headers,
    });
    expect(response.statusCode).toBe(404);
  });

  it("reads empty season context state", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/admin/seasons/${seasonA}/score-context`,
      headers,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.season.id).toBe(seasonA);
    expect(body.published).toBeNull();
    expect(body.draft).toBeNull();
    expect(body.distributionMissing).toBe(true);
    expect(body.latestDistribution).toBeNull();
    expect(body.canonicalSpecializations.classes.length).toBeGreaterThan(10);
  });

  it("draft percentile rows come from imported key thresholds, not CharacterScore or rating cutoffs", async () => {
    const region = await prisma.region.findFirst();
    const realm = await prisma.realm.findFirst();
    if (!region || !realm) throw new Error("Need region/realm");
    const isolated = await prisma.season.create({
      data: {
        id: randomUUID(),
        slug: uniqueName("ctx-key-dist"),
        name: "Key Dist Season",
        regionId: region.id,
        blizzardSeasonId: 87301,
      },
    });
    const character = await prisma.character.create({
      data: {
        id: randomUUID(),
        regionId: realm.regionId,
        realmId: realm.id,
        normalizedName: uniqueName("scorechar").toLowerCase(),
        displayName: uniqueName("ScoreChar"),
      },
    });
    await prisma.characterScore.create({
      data: {
        id: randomUUID(),
        characterId: character.id,
        seasonId: isolated.id,
        scoringVersion: "test",
        selectedRuns: [],
        calculatedAt: new Date(),
        composite: 3400,
      },
    });

    const imported = await app.inject({
      method: "POST",
      url: `/api/v1/admin/seasons/${isolated.id}/score-context/distributions`,
      headers,
      payload: {
        source: "RAIDER_IO",
        sourceVersion: "median-key-v1",
        collectedAt: "2026-08-14T00:00:00.000Z",
        points: [
          { percentileBps: 5000, medianKeyThreshold: 12 },
          { percentileBps: 7500, medianKeyThreshold: 15 },
          { percentileBps: 9000, medianKeyThreshold: 18 },
          { percentileBps: 9500, medianKeyThreshold: 20 },
          { percentileBps: 9900, medianKeyThreshold: 22 },
          { percentileBps: 9990, medianKeyThreshold: 24 },
        ],
      },
    });
    expect(imported.statusCode).toBe(200);

    const loaded = await app.inject({
      method: "GET",
      url: `/api/v1/admin/seasons/${isolated.id}/score-context`,
      headers,
    });
    expect(loaded.json().latestDistribution.points).toEqual([
      { percentileBps: 5000, medianKeyThreshold: 12 },
      { percentileBps: 7500, medianKeyThreshold: 15 },
      { percentileBps: 9000, medianKeyThreshold: 18 },
      { percentileBps: 9500, medianKeyThreshold: 20 },
      { percentileBps: 9900, medianKeyThreshold: 22 },
      { percentileBps: 9990, medianKeyThreshold: 24 },
    ]);
    expect(loaded.json().keyRows.map((row: { percentileLabel: string; thresholds: { EU: number | null } }) => [
      row.percentileLabel,
      row.thresholds.EU,
    ])).toEqual(
      expect.arrayContaining([
        ["P75", null],
        ["P90", null],
      ]),
    );

    const draft = await app.inject({
      method: "POST",
      url: `/api/v1/admin/seasons/${isolated.id}/score-context/draft`,
      headers,
    });
    expect(draft.statusCode).toBe(200);
    const adopted = await app.inject({
      method: "POST",
      url: `/api/v1/admin/score-context/revisions/${draft.json().id}/use-latest-distribution`,
      headers,
    });
    expect(adopted.statusCode).toBe(200);
    const afterAdopt = await app.inject({
      method: "GET",
      url: `/api/v1/admin/seasons/${isolated.id}/score-context`,
      headers,
    });
    expect(afterAdopt.json().keyRows.map((row: { percentileLabel: string; thresholds: { EU: number | null } }) => [
      row.percentileLabel,
      row.thresholds.EU,
    ])).toEqual(
      expect.arrayContaining([
        ["P75", 15],
        ["P90", 18],
        ["P99", 22],
        ["P99.9", 24],
      ]),
    );
    expect(draft.json().percentileAnchors.length).toBeGreaterThan(0);
  });

  it("imports a valid distribution and rejects malformed points", async () => {
    const good = await app.inject({
      method: "POST",
      url: `/api/v1/admin/seasons/${seasonA}/score-context/distributions`,
      headers,
      payload: {
        source: "FIXTURE_LOCAL",
        sourceVersion: "fixture-v1",
        collectedAt: "2026-08-01T00:00:00.000Z",
        points: [
          { percentileBps: 9000, medianKeyThreshold: 18 },
          { percentileBps: 9900, medianKeyThreshold: 22 },
          { percentileBps: 9990, medianKeyThreshold: 22 },
        ],
      },
    });
    expect(good.statusCode).toBe(200);
    expect(good.json().immutable).toBe(true);

    const bad = await app.inject({
      method: "POST",
      url: `/api/v1/admin/seasons/${seasonA}/score-context/distributions`,
      headers,
      payload: {
        source: "FIXTURE_LOCAL",
        collectedAt: "2026-08-01T00:00:00.000Z",
        points: [{ percentileBps: 9000, medianKeyThreshold: 18 }, { percentileBps: 9000, medianKeyThreshold: 19 }],
      },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe("INVALID_MEDIAN_KEY_DISTRIBUTION");
  });

  it("creates a draft, updates it, publishes, and archives the previous published revision", async () => {
    const distId = (
      await prisma.seasonMedianKeyDistributionSnapshot.findFirst({ where: { seasonId: seasonA } })
    )?.id;
    expect(distId).toBeTruthy();

    const draftRes = await app.inject({
      method: "POST",
      url: `/api/v1/admin/seasons/${seasonA}/score-context/draft`,
      headers,
    });
    expect(draftRes.statusCode).toBe(200);
    const draftId = draftRes.json().id as string;

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/score-context/revisions/${draftId}`,
      headers,
      payload: {
        tierFactors: { 1: 0.9, 2: 0.95, 3: 1, 4: 1.05, 5: 1.1 },
        specAssignments: [{ classSlug: "mage", specSlug: "frost", tier: 4 }],
        percentileAnchors: [
          { percentileBps: 9000, factor: 0.9 },
          { percentileBps: 9900, factor: 1.1 },
        ],
      },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().percentileAnchors[0].percentileBps).toBe(9000);

    const adopted = await app.inject({
      method: "POST",
      url: `/api/v1/admin/score-context/revisions/${draftId}/use-latest-distribution`,
      headers,
    });
    expect(adopted.statusCode).toBe(200);

    const afterPatchState = await app.inject({
      method: "GET",
      url: `/api/v1/admin/seasons/${seasonA}/score-context`,
      headers,
    });
    expect(afterPatchState.statusCode).toBe(200);
    expect(afterPatchState.json().keyRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          percentileBps: 9000,
          thresholds: expect.objectContaining({ EU: expect.any(Number) }),
        }),
      ]),
    );
    expect(afterPatchState.json().policy).toBeTruthy();

    const published1 = await app.inject({
      method: "POST",
      url: `/api/v1/admin/score-context/revisions/${draftId}/publish`,
      headers,
    });
    expect(published1.statusCode).toBe(200);
    expect(published1.json().revision.status).toBe("PUBLISHED");
    expect(published1.json().recalc.pinnedSeasonId).toBe(seasonA);
    expect(published1.json().recalc.pinnedSeasonId).not.toBe(seasonB);

    const mutatePublished = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/score-context/revisions/${draftId}`,
      headers,
      payload: { tierFactors: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 } },
    });
    expect(mutatePublished.statusCode).toBe(409);

    const draft2 = await app.inject({
      method: "POST",
      url: `/api/v1/admin/seasons/${seasonA}/score-context/draft`,
      headers,
    });
    const published2 = await app.inject({
      method: "POST",
      url: `/api/v1/admin/score-context/revisions/${draft2.json().id}/publish`,
      headers,
    });
    expect(published2.statusCode).toBe(200);

    const state = await app.inject({
      method: "GET",
      url: `/api/v1/admin/seasons/${seasonA}/score-context`,
      headers,
    });
    const archived = state.json().history.filter((h: { status: string }) => h.status === "ARCHIVED");
    expect(archived.length).toBeGreaterThanOrEqual(1);
    expect(state.json().published.id).toBe(published2.json().revision.id);

    const importAudit = await prisma.auditEvent.findFirst({
      where: {
        action: "admin.score_context.distribution.import",
        resourceId: distId!,
      },
    });
    expect(importAudit).toBeTruthy();

    const publishAudit = await prisma.auditEvent.findFirst({
      where: {
        action: "admin.score_context.publish",
        resourceId: published2.json().revision.id,
      },
    });
    expect(publishAudit).toBeTruthy();
  });

  it("surfaces enqueue failure as retryable without mutating the published revision", async () => {
    enqueueBulk.mockRejectedValueOnce(new Error("queue down"));
    const realm = await prisma.realm.findFirst();
    if (!realm) throw new Error("Need a realm");
    const character = await prisma.character.create({
      data: {
        id: randomUUID(),
        regionId: realm.regionId,
        realmId: realm.id,
        normalizedName: uniqueName("ctxchar").toLowerCase(),
        displayName: uniqueName("CtxChar"),
      },
    });
    await prisma.characterScore.create({
      data: {
        id: randomUUID(),
        characterId: character.id,
        seasonId: seasonA,
        scoringVersion: "test",
        selectedRuns: [],
        calculatedAt: new Date(),
        composite: 70,
      },
    });
    const draft = await app.inject({
      method: "POST",
      url: `/api/v1/admin/seasons/${seasonA}/score-context/draft`,
      headers,
    });
    const published = await app.inject({
      method: "POST",
      url: `/api/v1/admin/score-context/revisions/${draft.json().id}/publish`,
      headers,
    });
    expect(published.statusCode).toBe(200);
    expect(published.json().revision.status).toBe("PUBLISHED");
    expect(published.json().recalc.status).toBe("ENQUEUE_FAILED");
    expect(published.json().recalc.retryAvailable).toBe(true);

    enqueueBulk.mockResolvedValue({
      jobId: "ok",
      dedupeKey: "ok",
      reused: false,
      enqueued: true,
    });
    const retry = await app.inject({
      method: "POST",
      url: `/api/v1/admin/seasons/${seasonA}/score-context/recalculate`,
      headers,
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json().recalc.status).toBe("QUEUED");
    expect(retry.json().recalc.pinnedSeasonId).toBe(seasonA);
    const op = await prisma.bulkOperation.findUnique({
      where: { id: retry.json().recalc.bulkOperationId },
    });
    expect((op?.configSnapshot as { pinnedSeasonId?: string } | null)?.pinnedSeasonId).toBe(seasonA);
  });
});
