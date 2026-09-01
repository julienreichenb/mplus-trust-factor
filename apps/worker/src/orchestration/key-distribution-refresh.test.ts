import { afterAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { RAIDER_IO_ADDON_DISTRIBUTION_SOURCE } from "@mplus/contracts";
import { checkDatabaseHealth, createPrismaClient, SeasonScoreContextRepository } from "@mplus/database";
import { assertTestDatabaseAllowed } from "@mplus/test-utils";
import { AddonDbFormatError } from "@mplus/provider-raiderio";
import { hasSuccessfulIngestForArtifact, withSharedAddonIngestSession } from "./key-distribution-refresh.js";
import { defaultNeutralTierFactors } from "@mplus/scoring";

const databaseUrl = process.env.DATABASE_URL ?? "";
assertTestDatabaseAllowed(databaseUrl);
const prisma = createPrismaClient(databaseUrl);
const health = await checkDatabaseHealth(prisma);
const dbAvailable = health.ok;

afterAll(async () => {
  await prisma.$disconnect();
});

function points(p90: number) {
  return [
    { percentileBps: 6000, medianKeyThreshold: p90 - 4 },
    { percentileBps: 7500, medianKeyThreshold: p90 - 2 },
    { percentileBps: 9000, medianKeyThreshold: p90 },
    { percentileBps: 9900, medianKeyThreshold: p90 + 4 },
    { percentileBps: 9990, medianKeyThreshold: p90 + 5 },
  ];
}

function saturatedPackedTailPoints() {
  return [
    { percentileBps: 6000, medianKeyThreshold: 57 },
    { percentileBps: 7500, medianKeyThreshold: 58 },
    { percentileBps: 9000, medianKeyThreshold: 61 },
    { percentileBps: 9900, medianKeyThreshold: 62 },
    { percentileBps: 9990, medianKeyThreshold: 63 },
  ];
}

describe.skipIf(!dbAvailable)("shared Raider.IO acquisition", { timeout: 30_000 }, () => {
  it("artifact reuse rejects legacy corrupt saturated snapshots and accepts valid ones", async () => {
    const region = await prisma.region.findUniqueOrThrow({ where: { code: "EU" } });
    const season = await prisma.season.create({
      data: {
        id: randomUUID(),
        slug: `reuse-valid-${randomUUID().slice(0, 8)}`,
        name: "Reuse valid",
        regionId: region.id,
        blizzardSeasonId: 88723,
        isCurrent: true,
      },
    });
    const releaseTag = "v202608140600";
    const assetSha256 = "abc";
    await prisma.seasonMedianKeyDistributionSnapshot.create({
      data: {
        id: randomUUID(),
        seasonId: season.id,
        source: RAIDER_IO_ADDON_DISTRIBUTION_SOURCE,
        sourceVersion: releaseTag,
        collectedAt: new Date("2026-08-15T00:00:00.000Z"),
        contentHash: `corrupt-${season.id}`,
        points: saturatedPackedTailPoints(),
        provenance: { releaseTag, assetSha256 },
      },
    });
    expect(
      await hasSuccessfulIngestForArtifact(prisma, { seasonId: season.id, releaseTag, assetSha256 }),
    ).toBeNull();

    const repo = new SeasonScoreContextRepository(prisma);
    const valid = await repo.importDistribution({
      seasonId: season.id,
      source: RAIDER_IO_ADDON_DISTRIBUTION_SOURCE,
      provenance: { releaseTag, assetSha256 },
      sourceVersion: releaseTag,
      collectedAt: new Date("2026-08-16T00:00:00.000Z"),
      points: points(15),
      contentHash: `valid-${season.id}`,
    });
    expect(
      await hasSuccessfulIngestForArtifact(prisma, { seasonId: season.id, releaseTag, assetSha256 }),
    ).toEqual({ snapshotId: valid.id });
  });

  it("does not skip ingest when only matching artifact snapshot is legacy corrupt", async () => {
    const region = await prisma.region.findUniqueOrThrow({ where: { code: "EU" } });
    const season = await prisma.season.create({
      data: {
        id: randomUUID(),
        slug: `legacy-corrupt-${randomUUID().slice(0, 8)}`,
        name: "Legacy corrupt",
        regionId: region.id,
        blizzardSeasonId: 88724,
        isCurrent: true,
      },
    });
    const releaseTag = "v202608140600";
    const assetSha256 = "abc";
    await prisma.seasonMedianKeyDistributionSnapshot.create({
      data: {
        id: randomUUID(),
        seasonId: season.id,
        source: RAIDER_IO_ADDON_DISTRIBUTION_SOURCE,
        sourceVersion: releaseTag,
        collectedAt: new Date("2026-08-15T00:00:00.000Z"),
        contentHash: `legacy-corrupt-${season.id}`,
        points: saturatedPackedTailPoints(),
        provenance: { releaseTag, assetSha256 },
      },
    });
    const ingest = vi.fn(async (input: { regionCode: string; assetSha256: string; releaseTag: string }) => ({
      source: RAIDER_IO_ADDON_DISTRIBUTION_SOURCE,
      region: input.regionCode,
      points: points(16),
      population: { indexedCharacters: 10, eligibleCharacters: 8, inclusionPolicy: "ALL_8" },
      sourceMetadata: { releaseTag: input.releaseTag, assetSha256: input.assetSha256 },
      contentHash: `reingest-${season.id}`,
    }));
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    await withSharedAddonIngestSession(
      {
        prisma,
        logger: logger as never,
        hooks: {
          selectLatestMainlineAddonRelease: async () =>
            ({
              tag: releaseTag,
              assetName: "RaiderIO-v202608140600.zip",
              assetUrl: "https://example.test/addon.zip",
              githubAssetId: 1,
              assetSha256,
            }) as never,
          downloadReleaseZip: async () => ({ zipPath: "z.zip", sha256: assetSha256 }),
          extractRequiredAddonFiles: async () => ({
            lookupPath: "l.lua",
            charactersPath: "c.lua",
            dungeonsPath: "d.lua",
            tocText: "",
          }),
          ingestMythicPlusAddonFiles: ingest as never,
        },
      },
      async (session) => {
        const result = await session.refreshRegion({ seasonId: season.id, regionCode: "EU" });
        expect(result.skipped).toBe(false);
        expect(result.reused).toBe(false);
        expect(result.snapshotId).toBeTruthy();
      },
    );
    expect(ingest).toHaveBeenCalledTimes(1);
    const latest = await prisma.seasonMedianKeyDistributionSnapshot.findFirst({
      where: { seasonId: season.id },
      orderBy: { collectedAt: "desc" },
    });
    expect(latest?.contentHash).toBe(`reingest-${season.id}`);
    expect(latest?.points).toEqual(points(16));
  });

  it("I/J/K: same release is idempotent; newer release snapshots without mutating published bindings; zip once", async () => {
    const region = await prisma.region.findUniqueOrThrow({ where: { code: "EU" } });
    const us = await prisma.region.upsert({
      where: { code: "US" },
      update: {},
      create: {
        code: "US",
        apiHost: "https://us.api.blizzard.com",
        localeDefault: "en_US",
        enabled: true,
      },
    });
    const blizzardSeasonId = 88501;
    const euSeason = await prisma.season.create({
      data: {
        id: randomUUID(),
        slug: `rio-eu-${randomUUID().slice(0, 8)}`,
        name: "RIO EU",
        regionId: region.id,
        blizzardSeasonId,
        isCurrent: true,
      },
    });
    const usSeason = await prisma.season.create({
      data: {
        id: randomUUID(),
        slug: `rio-us-${randomUUID().slice(0, 8)}`,
        name: "RIO US",
        regionId: us.id,
        blizzardSeasonId,
        isCurrent: true,
      },
    });
    const repo = new SeasonScoreContextRepository(prisma);
    const euFrozen = await repo.importDistribution({
      seasonId: euSeason.id,
      source: RAIDER_IO_ADDON_DISTRIBUTION_SOURCE,
      provenance: { releaseTag: "v202608140600", assetSha256: "abc" },
      sourceVersion: "v202608140600",
      collectedAt: new Date("2026-08-14T06:00:00.000Z"),
      points: points(18),
      contentHash: `hash-18-${euSeason.id}`,
    });
    await repo.importDistribution({
      seasonId: usSeason.id,
      source: RAIDER_IO_ADDON_DISTRIBUTION_SOURCE,
      provenance: { releaseTag: "v202608140600", assetSha256: "abc" },
      sourceVersion: "v202608140600",
      collectedAt: new Date("2026-08-14T06:00:00.000Z"),
      points: points(18),
      contentHash: `hash-18-${usSeason.id}`,
    });
    const draft = await repo.createDraft({
      blizzardSeasonId,
      seasonId: euSeason.id,
      percentileAnchors: [{ percentileBps: 9000, factor: 1.1 }],
      tierFactors: defaultNeutralTierFactors(),
    });
    await repo.bindRegionSnapshot({
      revisionId: draft.id,
      regionCode: "EU",
      snapshotId: euFrozen.id,
    });
    const published = await repo.publish(draft.id);

    const download = vi.fn(async () => ({ zipPath: "shared.zip", sha256: "abc" }));
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

    await withSharedAddonIngestSession(
      {
        prisma,
        logger: logger as never,
        hooks: {
          selectLatestMainlineAddonRelease: async () =>
            ({
              repository: "RaiderIO/raiderio-addon",
              tag: "v202608140600",
              publishedAt: null,
              assetName: "RaiderIO-v202608140600.zip",
              assetUrl: "https://example.test/addon.zip",
              githubAssetId: 1,
              assetSha256: "abc",
            }) as never,
          downloadReleaseZip: download,
        },
      },
      async (session) => {
        await session.refreshRegion({ seasonId: euSeason.id, regionCode: "EU" });
        await session.refreshRegion({ seasonId: usSeason.id, regionCode: "US" });
        expect(session.downloadCount()).toBe(0);
      },
    );
    expect(download).not.toHaveBeenCalled();

    const ingest = vi.fn(async (input: { regionCode: string; assetSha256: string; releaseTag: string }) => ({
      source: RAIDER_IO_ADDON_DISTRIBUTION_SOURCE,
      region: input.regionCode,
      points: points(19),
      population: { indexedCharacters: 10, eligibleCharacters: 8, inclusionPolicy: "ALL_8" },
      sourceMetadata: { releaseTag: input.releaseTag, assetSha256: input.assetSha256 },
      contentHash: `hash-19-${input.regionCode}-${input.releaseTag}`,
    }));
    await withSharedAddonIngestSession(
      {
        prisma,
        logger: logger as never,
        hooks: {
          selectLatestMainlineAddonRelease: async () =>
            ({
              repository: "RaiderIO/raiderio-addon",
              tag: "v202608150600",
              publishedAt: null,
              assetName: "RaiderIO-v202608150600.zip",
              assetUrl: "https://example.test/addon2.zip",
              githubAssetId: 2,
            }) as never,
          downloadReleaseZip: download,
          extractRequiredAddonFiles: async () => ({
            lookupPath: "l.lua",
            charactersPath: "c.lua",
            dungeonsPath: "d.lua",
            tocText: "",
          }),
          ingestMythicPlusAddonFiles: ingest as never,
        },
      },
      async (session) => {
        await session.refreshRegion({ seasonId: euSeason.id, regionCode: "EU" });
        await session.refreshRegion({ seasonId: usSeason.id, regionCode: "US" });
        expect(session.downloadCount()).toBe(1);
      },
    );
    expect(download).toHaveBeenCalledTimes(1);
    expect(ingest).toHaveBeenCalledTimes(2);

    const rebound = await prisma.scoreContextRevisionRegionSnapshot.findMany({
      where: { revisionId: published.id },
    });
    expect(rebound.find((b) => b.regionCode === "EU")?.distributionSnapshotId).toBe(euFrozen.id);
    const latestEu = await prisma.seasonMedianKeyDistributionSnapshot.findFirst({
      where: { seasonId: euSeason.id },
      orderBy: { collectedAt: "desc" },
    });
    expect(latestEu?.id).not.toBe(euFrozen.id);
    expect(latestEu?.sourceVersion).toBe("v202608150600");
  });

  it("G: same release tag + different asset SHA is not skipped", async () => {
    const region = await prisma.region.findUniqueOrThrow({ where: { code: "EU" } });
    const season = await prisma.season.create({
      data: {
        id: randomUUID(),
        slug: `sha-diff-${randomUUID().slice(0, 8)}`,
        name: "SHA diff",
        regionId: region.id,
        blizzardSeasonId: 88721,
        isCurrent: true,
      },
    });
    const repo = new SeasonScoreContextRepository(prisma);
    await repo.importDistribution({
      seasonId: season.id,
      source: RAIDER_IO_ADDON_DISTRIBUTION_SOURCE,
      provenance: { releaseTag: "v202608140600", assetSha256: "aaa" },
      sourceVersion: "v202608140600",
      collectedAt: new Date(),
      points: points(18),
      contentHash: `hash-aaa-${season.id}`,
    });
    const download = vi.fn(async () => ({ zipPath: "z.zip", sha256: "bbb" }));
    const ingest = vi.fn(async (input: { regionCode: string; assetSha256: string; releaseTag: string }) => ({
      source: RAIDER_IO_ADDON_DISTRIBUTION_SOURCE,
      region: input.regionCode,
      points: points(19),
      population: { indexedCharacters: 10, eligibleCharacters: 8, inclusionPolicy: "ALL_8" },
      sourceMetadata: { releaseTag: input.releaseTag, assetSha256: input.assetSha256 },
      contentHash: `hash-bbb-${season.id}`,
    }));
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    await withSharedAddonIngestSession(
      {
        prisma,
        logger: logger as never,
        hooks: {
          selectLatestMainlineAddonRelease: async () =>
            ({
              tag: "v202608140600",
              assetName: "RaiderIO-v202608140600.zip",
              assetUrl: "https://example.test/addon.zip",
              githubAssetId: 1,
              assetSha256: "bbb",
            }) as never,
          downloadReleaseZip: download,
          extractRequiredAddonFiles: async () => ({
            lookupPath: "l.lua",
            charactersPath: "c.lua",
            dungeonsPath: "d.lua",
            tocText: "",
          }),
          ingestMythicPlusAddonFiles: ingest as never,
        },
      },
      async (session) => {
        const result = await session.refreshRegion({ seasonId: season.id, regionCode: "EU" });
        expect(result.skipped).toBe(false);
        expect(session.downloadCount()).toBe(1);
      },
    );
    expect(ingest).toHaveBeenCalledTimes(1);
    const latest = await prisma.seasonMedianKeyDistributionSnapshot.findFirst({
      where: { seasonId: season.id },
      orderBy: { collectedAt: "desc" },
    });
    expect(latest?.contentHash).toBe(`hash-bbb-${season.id}`);
  });

  it("H: previous FAILED refresh with same release does not block retry", async () => {
    const region = await prisma.region.findUniqueOrThrow({ where: { code: "EU" } });
    const season = await prisma.season.create({
      data: {
        id: randomUUID(),
        slug: `fail-retry-${randomUUID().slice(0, 8)}`,
        name: "Fail retry",
        regionId: region.id,
        blizzardSeasonId: 88722,
        isCurrent: true,
      },
    });
    await prisma.scoreContextKeyDistributionRefresh.create({
      data: {
        id: randomUUID(),
        seasonId: season.id,
        region: "EU",
        status: "FAILED",
        errorMessage: "previous failure",
      },
    });
    const ingest = vi.fn(async (input: { regionCode: string; assetSha256: string; releaseTag: string }) => ({
      source: RAIDER_IO_ADDON_DISTRIBUTION_SOURCE,
      region: input.regionCode,
      points: points(18),
      population: { indexedCharacters: 10, eligibleCharacters: 8, inclusionPolicy: "ALL_8" },
      sourceMetadata: { releaseTag: input.releaseTag, assetSha256: input.assetSha256 },
      contentHash: `hash-retry-${season.id}`,
    }));
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    await withSharedAddonIngestSession(
      {
        prisma,
        logger: logger as never,
        hooks: {
          selectLatestMainlineAddonRelease: async () =>
            ({
              tag: "v202608140600",
              assetName: "RaiderIO-v202608140600.zip",
              assetUrl: "https://example.test/addon.zip",
              githubAssetId: 1,
              assetSha256: "abc",
            }) as never,
          downloadReleaseZip: async () => ({ zipPath: "z.zip", sha256: "abc" }),
          extractRequiredAddonFiles: async () => ({
            lookupPath: "l.lua",
            charactersPath: "c.lua",
            dungeonsPath: "d.lua",
            tocText: "",
          }),
          ingestMythicPlusAddonFiles: ingest as never,
        },
      },
      async (session) => {
        const result = await session.refreshRegion({ seasonId: season.id, regionCode: "EU" });
        expect(result.skipped).toBe(false);
        expect(result.snapshotId).toBeTruthy();
      },
    );
    expect(ingest).toHaveBeenCalledTimes(1);
  });

  it("PINNED historical mismatch is NOT_CURRENT_SOURCE without a snapshot", async () => {
    const region = await prisma.region.findUniqueOrThrow({ where: { code: "EU" } });
    const season = await prisma.season.create({
      data: {
        id: randomUUID(),
        slug: `hist-${randomUUID().slice(0, 8)}`,
        name: "Historical",
        regionId: region.id,
        blizzardSeasonId: 88613,
        isCurrent: false,
      },
    });
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    await withSharedAddonIngestSession(
      {
        prisma,
        logger: logger as never,
        hooks: {
          selectLatestMainlineAddonRelease: async () =>
            ({
              repository: "RaiderIO/raiderio-addon",
              tag: "v202608140600",
              publishedAt: null,
              assetName: "RaiderIO-v202608140600.zip",
              assetUrl: "https://example.test/addon.zip",
              githubAssetId: 1,
            }) as never,
          downloadReleaseZip: async () => ({ zipPath: "z.zip", sha256: "x" }),
          extractRequiredAddonFiles: async () => ({
            lookupPath: "l.lua",
            charactersPath: "c.lua",
            dungeonsPath: "d.lua",
            tocText: "",
          }),
          ingestMythicPlusAddonFiles: async () => {
            throw new AddonDbFormatError("DUNGEON_MAP", "No unique platform dungeon");
          },
        },
      },
      async (session) => {
        const result = await session.refreshRegion({ seasonId: season.id, regionCode: "EU" });
        expect(result.skipped).toBe(true);
        expect(result.snapshotId).toBeNull();
      },
    );
    const refresh = await prisma.scoreContextKeyDistributionRefresh.findFirst({
      where: { seasonId: season.id },
      orderBy: { createdAt: "desc" },
    });
    expect(refresh?.status).toBe("SKIPPED");
    expect(refresh?.errorMessage).toContain("NOT_CURRENT_SOURCE");
  });
});
