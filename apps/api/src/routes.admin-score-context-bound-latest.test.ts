import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { SeasonScoreContextRepository, type PrismaClient } from "@mplus/database";
import { KEY_CONTEXT_REGION_CODES } from "@mplus/contracts";
import type { QueueProducers } from "@mplus/worker";
import { buildApp } from "./app.js";
import { createApiContainer, type ApiContainer } from "./container.js";
import { buildTestEnv, createTestPrismaClient, uniqueName } from "./test-helpers.js";
import { ensureIamSeed } from "./iam/seed.js";

const { prisma, dbAvailable } = await createTestPrismaClient();
const ADMIN_KEY = "test-admin-key-bound-latest";
const BLIZZARD = 88301;
const OTHER_BLIZZARD = 88302;

afterAll(async () => {
  await prisma.$disconnect();
});

function stubProducers(): QueueProducers {
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
    enqueueBulkCharacterProcessing: ok,
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

function points(p90: number, p99 = p90 + 4) {
  return [
    { percentileBps: 6000, medianKeyThreshold: p90 - 4 },
    { percentileBps: 7500, medianKeyThreshold: p90 - 2 },
    { percentileBps: 9000, medianKeyThreshold: p90 },
    { percentileBps: 9900, medianKeyThreshold: p99 },
    { percentileBps: 9990, medianKeyThreshold: p99 + 1 },
  ];
}

describe.skipIf(!dbAvailable)("admin score context bound vs latest", { timeout: 60_000 }, () => {
  let app: FastifyInstance;
  let container: ApiContainer;
  const seasons: Record<string, string> = {};
  const headers = { "x-admin-api-key": ADMIN_KEY };

  beforeAll(async () => {
    const env = buildTestEnv({
      ADMIN_API_KEY: ADMIN_KEY,
      ADMIN_API_KEY_EMERGENCY_FALLBACK: "true",
    });
    for (const code of KEY_CONTEXT_REGION_CODES) {
      await prisma.region.upsert({
        where: { code },
        update: {},
        create: {
          code,
          apiHost: `https://${code.toLowerCase()}.api.blizzard.com`,
          localeDefault: "en_US",
          enabled: true,
        },
      });
      const region = await prisma.region.findUniqueOrThrow({ where: { code } });
      const row = await prisma.season.create({
        data: {
          id: randomUUID(),
          slug: uniqueName(`bound-${code.toLowerCase()}`),
          name: `Bound ${code}`,
          regionId: region.id,
          blizzardSeasonId: BLIZZARD,
        },
      });
      seasons[code] = row.id;
    }
    try {
      await ensureIamSeed(prisma as PrismaClient);
    } catch {
      // Parallel suites may have already seeded IAM.
    }
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

  it("A/B/C/D/E/F/G/L: bound table, adopt latest, publish validation, new season draft", async () => {
    async function importDist(seasonId: string, p90: number, collectedAt: string) {
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/admin/seasons/${seasonId}/score-context/distributions`,
        headers,
        payload: {
          source: "FIXTURE_LOCAL",
          sourceVersion: `p90-${p90}-${collectedAt}`,
          collectedAt,
          points: points(p90),
        },
      });
      expect(res.statusCode).toBe(200);
      return res.json().id as string;
    }

    const frozenEu = await importDist(seasons.EU, 18, "2026-08-01T00:00:00.000Z");
    await importDist(seasons.US, 17, "2026-08-01T00:00:00.000Z");
    await importDist(seasons.KR, 18, "2026-08-01T00:00:00.000Z");
    await importDist(seasons.TW, 18, "2026-08-01T00:00:00.000Z");

    const draft1 = await app.inject({
      method: "POST",
      url: `/api/v1/admin/seasons/${seasons.EU}/score-context/draft`,
      headers,
    });
    expect(draft1.statusCode).toBe(200);
    const patch = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/score-context/revisions/${draft1.json().id}`,
      headers,
      payload: {
        percentileAnchors: [
          { percentileBps: 6000, factor: 0.9 },
          { percentileBps: 7500, factor: 0.95 },
          { percentileBps: 9000, factor: 1.05 },
          { percentileBps: 9900, factor: 1.2 },
          { percentileBps: 9990, factor: 1.3 },
        ],
      },
    });
    expect(patch.statusCode).toBe(200);
    expect(
      (await app.inject({
        method: "POST",
        url: `/api/v1/admin/score-context/revisions/${draft1.json().id}/use-latest-distribution`,
        headers,
      })).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({
        method: "POST",
        url: `/api/v1/admin/score-context/revisions/${draft1.json().id}/publish`,
        headers,
      })).statusCode,
    ).toBe(200);

    const latestEu = await importDist(seasons.EU, 19, "2026-08-14T00:00:00.000Z");
    expect(latestEu).not.toBe(frozenEu);

    const publishedState = await app.inject({
      method: "GET",
      url: `/api/v1/admin/seasons/${seasons.EU}/score-context`,
      headers,
    });
    expect(publishedState.statusCode).toBe(200);
    const body = publishedState.json();
    const p90 = body.keyRows.find((row: { percentileBps: number }) => row.percentileBps === 9000);
    // Provider facts are auto-effective: Key table shows latest valid thresholds without republish.
    expect(p90.thresholds.EU).toBe(19);
    expect(body.regions.EU.hasNewerDistribution).toBe(true);
    expect(body.policy.regionalSnapshots.EU.id).toBe(frozenEu);
    expect(body.regions.EU.latestDistribution.id).toBe(latestEu);

    // Corrupt Raider.IO-shaped refresh must not displace the effective latest (LKG).
    const corrupt = await app.inject({
      method: "POST",
      url: `/api/v1/admin/seasons/${seasons.EU}/score-context/distributions`,
      headers,
      payload: {
        source: "RAIDER_IO_ADDON",
        sourceVersion: "corrupt-sat",
        collectedAt: "2026-08-15T00:00:00.000Z",
        points: points(61),
      },
    });
    expect(corrupt.statusCode).toBeGreaterThanOrEqual(400);
    const afterCorrupt = await app.inject({
      method: "GET",
      url: `/api/v1/admin/seasons/${seasons.EU}/score-context`,
      headers,
    });
    expect(
      afterCorrupt.json().keyRows.find((row: { percentileBps: number }) => row.percentileBps === 9000)
        .thresholds.EU,
    ).toBe(19);
    expect(afterCorrupt.json().regions.EU.latestDistribution.id).toBe(latestEu);

    const draft2 = await app.inject({
      method: "POST",
      url: `/api/v1/admin/seasons/${seasons.EU}/score-context/draft`,
      headers,
    });
    expect(
      (await app.inject({
        method: "POST",
        url: `/api/v1/admin/score-context/revisions/${draft2.json().id}/use-latest-distribution`,
        headers,
      })).statusCode,
    ).toBe(200);
    const draftState = await app.inject({
      method: "GET",
      url: `/api/v1/admin/seasons/${seasons.EU}/score-context`,
      headers,
    });
    const draftP90 = draftState.json().keyRows.find((row: { percentileBps: number }) => row.percentileBps === 9000);
    expect(draftP90.thresholds.EU).toBe(19);
    expect(draftP90.factor).toBe(1.05);
    const publishedBindings = await prisma.scoreContextRevisionRegionSnapshot.findMany({
      where: { revisionId: body.published.id },
    });
    expect(publishedBindings.find((b) => b.regionCode === "EU")?.distributionSnapshotId).toBe(frozenEu);

    const published2 = await app.inject({
      method: "POST",
      url: `/api/v1/admin/score-context/revisions/${draft2.json().id}/publish`,
      headers,
    });
    expect(published2.statusCode).toBe(200);
    const frozen = await prisma.scoreContextRevisionRegionSnapshot.findMany({
      where: { revisionId: published2.json().revision.id },
    });
    expect(frozen.find((b) => b.regionCode === "EU")?.distributionSnapshotId).toBe(latestEu);

    const repo = new SeasonScoreContextRepository(prisma);
    const usSnap = await prisma.seasonMedianKeyDistributionSnapshot.findFirst({
      where: { seasonId: seasons.US },
    });
    const crossDraft = await repo.createDraft({ blizzardSeasonId: BLIZZARD, seasonId: seasons.EU });
    await expect(
      repo.bindRegionSnapshot({
        revisionId: crossDraft.id,
        regionCode: "EU",
        snapshotId: usSnap!.id,
      }),
    ).rejects.toMatchObject({ code: "CROSS_REGION_SNAPSHOT_BINDING" });

    const otherRegion = await prisma.region.findUniqueOrThrow({ where: { code: "EU" } });
    const otherSeason = await prisma.season.create({
      data: {
        id: randomUUID(),
        slug: uniqueName("other-bliz"),
        name: "Other blizzard",
        regionId: otherRegion.id,
        blizzardSeasonId: OTHER_BLIZZARD,
      },
    });
    const otherSnap = await repo.importDistribution({
      seasonId: otherSeason.id,
      source: "FIXTURE_LOCAL",
      sourceVersion: "other",
      collectedAt: new Date(),
      points: points(12),
      contentHash: randomUUID(),
    });
    await expect(
      repo.bindRegionSnapshot({
        revisionId: crossDraft.id,
        regionCode: "EU",
        snapshotId: otherSnap.id,
      }),
    ).rejects.toMatchObject({ code: "CROSS_BLIZZARD_SEASON_SNAPSHOT_BINDING" });

    const newBlizzard = 88399;
    const fresh: Record<string, string> = {};
    for (const code of KEY_CONTEXT_REGION_CODES) {
      const region = await prisma.region.findUniqueOrThrow({ where: { code } });
      fresh[code] = (
        await prisma.season.create({
          data: {
            id: randomUUID(),
            slug: uniqueName(`fresh-${code.toLowerCase()}`),
            name: `Fresh ${code}`,
            regionId: region.id,
            blizzardSeasonId: newBlizzard,
          },
        })
      ).id;
      await repo.importDistribution({
        seasonId: fresh[code],
        source: "FIXTURE_LOCAL",
        sourceVersion: "fresh",
        collectedAt: new Date(),
        points: points(10),
        contentHash: randomUUID(),
      });
    }
    const loaded = await app.inject({
      method: "GET",
      url: `/api/v1/admin/seasons/${fresh.EU}/score-context`,
      headers,
    });
    expect(loaded.statusCode).toBe(200);
    expect(loaded.json().published).toBeNull();
    expect(loaded.json().draft).toBeNull();
    const firstDraft = await app.inject({
      method: "POST",
      url: `/api/v1/admin/seasons/${fresh.EU}/score-context/draft`,
      headers,
    });
    expect(firstDraft.statusCode).toBe(200);
    expect(firstDraft.json().blizzardSeasonId).toBe(newBlizzard);
    expect(firstDraft.json().percentileAnchors.every((a: { factor: number }) => a.factor === 1)).toBe(true);
    expect(firstDraft.json().tierFactors).toEqual({ 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 });
    expect(firstDraft.json().regionSnapshots).toHaveLength(4);
    const afterFirst = await app.inject({
      method: "GET",
      url: `/api/v1/admin/seasons/${fresh.EU}/score-context`,
      headers,
    });
    expect(afterFirst.json().keyRows.find((r: { percentileBps: number }) => r.percentileBps === 9000).thresholds).toEqual({
      EU: 10,
      US: 10,
      KR: 10,
      TW: 10,
    });
    expect(afterFirst.json().draft.status).toBe("DRAFT");
    expect(afterFirst.json().published).toBeNull();
  });

  it("A/B/C/D: first draft binds latest snapshots, leaves missing region uncovered, stays neutral", async () => {
    const blizzard = 88711;
    const repo = new SeasonScoreContextRepository(prisma);
    const created: Record<string, string> = {};
    for (const code of ["EU", "US", "KR"] as const) {
      const region = await prisma.region.findUniqueOrThrow({ where: { code } });
      created[code] = (
        await prisma.season.create({
          data: {
            id: randomUUID(),
            slug: uniqueName(`first-${code.toLowerCase()}`),
            name: `First ${code}`,
            regionId: region.id,
            blizzardSeasonId: blizzard,
          },
        })
      ).id;
      await repo.importDistribution({
        seasonId: created[code],
        source: "FIXTURE_LOCAL",
        sourceVersion: "first",
        collectedAt: new Date(),
        points: points(code === "EU" ? 18 : 16),
        contentHash: randomUUID(),
      });
    }
    const twRegion = await prisma.region.findUniqueOrThrow({ where: { code: "TW" } });
    created.TW = (
      await prisma.season.create({
        data: {
          id: randomUUID(),
          slug: uniqueName("first-tw"),
          name: "First TW",
          regionId: twRegion.id,
          blizzardSeasonId: blizzard,
        },
      })
    ).id;
    const ancestor = await repo.createDraft({
      blizzardSeasonId: 88710,
      percentileAnchors: [{ percentileBps: 9000, factor: 1.4 }],
    });
    await repo.publish(ancestor.id);

    const draft = await app.inject({
      method: "POST",
      url: `/api/v1/admin/seasons/${created.EU}/score-context/draft`,
      headers,
    });
    expect(draft.statusCode).toBe(200);
    expect(draft.json().percentileAnchors.every((a: { factor: number }) => a.factor === 1)).toBe(true);
    expect(draft.json().regionSnapshots.map((b: { regionCode: string }) => b.regionCode).sort()).toEqual([
      "EU",
      "KR",
      "US",
    ]);
    const state = await app.inject({
      method: "GET",
      url: `/api/v1/admin/seasons/${created.EU}/score-context`,
      headers,
    });
    const p90 = state.json().keyRows.find((r: { percentileBps: number }) => r.percentileBps === 9000);
    expect(p90.factor).toBe(1);
    expect(p90.thresholds.EU).toBe(18);
    expect(p90.thresholds.TW).toBeNull();
    expect(state.json().policy.missingRegionCoverage).toContain("TW");
    expect(state.json().published).toBeNull();
  });
});
