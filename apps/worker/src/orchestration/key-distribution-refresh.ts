import { randomUUID } from "node:crypto";
import { RAIDER_IO_ADDON_DISTRIBUTION_SOURCE } from "@mplus/contracts";
import { SeasonScoreContextRepository, type PrismaClient } from "@mplus/database";
import {
  AddonDbFormatError,
  downloadReleaseZip,
  extractRequiredAddonFiles,
  ingestMythicPlusAddonFiles,
  selectLatestMainlineAddonRelease,
  withTempDir,
  type SeasonDungeonIdentity,
} from "@mplus/provider-raiderio";
import type { Logger } from "@mplus/observability";

export type KeyDistributionRegion = "EU" | "US" | "KR" | "TW";

export interface KeyDistributionRefreshHooks {
  selectLatestMainlineAddonRelease?: typeof selectLatestMainlineAddonRelease;
  downloadReleaseZip?: typeof downloadReleaseZip;
  extractRequiredAddonFiles?: typeof extractRequiredAddonFiles;
  ingestMythicPlusAddonFiles?: typeof ingestMythicPlusAddonFiles;
}

const DUNGEON_IDENTITY_CODES = new Set([
  "DUNGEON_MAP",
  "DUNGEON_COUNT",
  "SEASON_DUNGEON_COUNT",
]);

export async function hasSuccessfulIngestForArtifact(
  prisma: PrismaClient,
  input: { seasonId: string; releaseTag: string; assetSha256: string },
): Promise<{ snapshotId: string } | null> {
  const sha = input.assetSha256.trim().toLowerCase();
  if (!sha) return null;
  const rows = await prisma.seasonMedianKeyDistributionSnapshot.findMany({
    where: {
      seasonId: input.seasonId,
      source: RAIDER_IO_ADDON_DISTRIBUTION_SOURCE,
      sourceVersion: input.releaseTag,
    },
    orderBy: { collectedAt: "desc" },
    select: { id: true, provenance: true },
  });
  for (const row of rows) {
    const provenance =
      row.provenance && typeof row.provenance === "object" && !Array.isArray(row.provenance)
        ? (row.provenance as Record<string, unknown>)
        : {};
    const stored = typeof provenance.assetSha256 === "string" ? provenance.assetSha256.trim().toLowerCase() : "";
    if (stored && stored === sha) {
      return { snapshotId: row.id };
    }
  }
  return null;
}

/** @deprecated Use hasSuccessfulIngestForArtifact (releaseTag + assetSha256). */
export async function hasSuccessfulIngestForRelease(
  prisma: PrismaClient,
  seasonId: string,
  releaseTag: string,
): Promise<{ snapshotId: string } | null> {
  const rows = await prisma.seasonMedianKeyDistributionSnapshot.findMany({
    where: {
      seasonId,
      source: RAIDER_IO_ADDON_DISTRIBUTION_SOURCE,
      sourceVersion: releaseTag,
    },
    orderBy: { collectedAt: "desc" },
    select: { id: true, provenance: true },
  });
  const withSha = rows.find((row) => {
    const provenance =
      row.provenance && typeof row.provenance === "object" && !Array.isArray(row.provenance)
        ? (row.provenance as Record<string, unknown>)
        : {};
    return typeof provenance.assetSha256 === "string" && provenance.assetSha256.trim() !== "";
  });
  return withSha ? { snapshotId: withSha.id } : null;
}

function isDungeonIdentityError(error: unknown): boolean {
  return error instanceof AddonDbFormatError && DUNGEON_IDENTITY_CODES.has(error.code);
}

export function createSharedAddonIngestSession(input: {
  prisma: PrismaClient;
  logger: Logger;
  workingDir: string;
  fetchImpl?: typeof fetch;
  hooks?: KeyDistributionRefreshHooks;
}): {
  refreshRegion: (input: {
    seasonId: string;
    regionCode: string;
    refreshId?: string;
  }) => Promise<{ snapshotId: string | null; reused: boolean; skipped: boolean; downloads: number }>;
  downloadCount: () => number;
} {
  const prisma = input.prisma;
  const logger = input.logger;
  const selectRelease = input.hooks?.selectLatestMainlineAddonRelease ?? selectLatestMainlineAddonRelease;
  const downloadZip = input.hooks?.downloadReleaseZip ?? downloadReleaseZip;
  const extractFiles = input.hooks?.extractRequiredAddonFiles ?? extractRequiredAddonFiles;
  const ingestFiles = input.hooks?.ingestMythicPlusAddonFiles ?? ingestMythicPlusAddonFiles;

  let selected: Awaited<ReturnType<typeof selectLatestMainlineAddonRelease>> | null = null;
  let zipPath: string | null = null;
  let sha256: string | null = null;
  let downloads = 0;

  async function ensureZip(): Promise<{
    selected: Awaited<ReturnType<typeof selectLatestMainlineAddonRelease>>;
    zipPath: string;
    sha256: string;
  }> {
    selected ??= await selectRelease(input.fetchImpl);
    if (!zipPath || !sha256) {
      const downloaded = await downloadZip(selected.assetUrl, input.workingDir, input.fetchImpl);
      downloads += 1;
      zipPath = downloaded.zipPath;
      sha256 = downloaded.sha256;
    }
    return { selected, zipPath, sha256 };
  }

  async function refreshRegion(regionInput: {
    seasonId: string;
    regionCode: string;
    refreshId?: string;
  }) {
    const region = regionInput.regionCode.trim().toUpperCase() as KeyDistributionRegion;
    if (region !== "EU" && region !== "US" && region !== "KR" && region !== "TW") {
      return { snapshotId: null, reused: false, skipped: true, downloads };
    }
    const season = await prisma.season.findUnique({
      where: { id: regionInput.seasonId },
      select: {
        id: true,
        isCurrent: true,
        blizzardSeasonId: true,
        region: { select: { code: true } },
      },
    });
    const seasonRegion = season?.region?.code?.toUpperCase();
    if (seasonRegion && seasonRegion !== region) {
      throw new Error(`KEY_DISTRIBUTION_REGION_MISMATCH: job ${region} vs season ${seasonRegion}`);
    }

    let refreshId = regionInput.refreshId;
    if (!refreshId) {
      refreshId = randomUUID();
      await prisma.scoreContextKeyDistributionRefresh.create({
        data: {
          id: refreshId,
          seasonId: regionInput.seasonId,
          region,
          status: "QUEUED",
        },
      });
    }
    await prisma.scoreContextKeyDistributionRefresh.update({
      where: { id: refreshId },
      data: { status: "RUNNING", startedAt: new Date(), errorMessage: null },
    });

    try {
      selected ??= await selectRelease(input.fetchImpl);
      logger.info({ tag: selected.tag, asset: selected.assetName, region }, "raiderio addon release selected");

      const knownSha = selected.assetSha256?.trim().toLowerCase() || null;
      if (knownSha) {
        const existing = await hasSuccessfulIngestForArtifact(prisma, {
          seasonId: regionInput.seasonId,
          releaseTag: selected.tag,
          assetSha256: knownSha,
        });
        if (existing) {
          await prisma.scoreContextKeyDistributionRefresh.update({
            where: { id: refreshId },
            data: {
              status: "SUCCEEDED",
              finishedAt: new Date(),
              snapshotId: existing.snapshotId,
              errorMessage: null,
            },
          });
          return { snapshotId: existing.snapshotId, reused: true, skipped: true, downloads };
        }
      }

      const acquired = await ensureZip();
      const existingAfterHash = await hasSuccessfulIngestForArtifact(prisma, {
        seasonId: regionInput.seasonId,
        releaseTag: acquired.selected.tag,
        assetSha256: acquired.sha256,
      });
      if (existingAfterHash) {
        await prisma.scoreContextKeyDistributionRefresh.update({
          where: { id: refreshId },
          data: {
            status: "SUCCEEDED",
            finishedAt: new Date(),
            snapshotId: existingAfterHash.snapshotId,
            errorMessage: null,
          },
        });
        return { snapshotId: existingAfterHash.snapshotId, reused: true, skipped: true, downloads };
      }
      const expected = await loadExpectedSeasonDungeons(prisma, regionInput.seasonId);
      const files = await extractFiles(acquired.zipPath, input.workingDir, region);
      const result = await ingestFiles({
        regionCode: region,
        lookupLuaPath: files.lookupPath,
        charactersLuaPath: files.charactersPath,
        dungeonsLuaPath: files.dungeonsPath,
        tocText: files.tocText,
        expectedDungeons: expected,
        releaseTag: acquired.selected.tag,
        assetName: acquired.selected.assetName,
        assetSha256: acquired.sha256,
        githubPublishedAt: acquired.selected.publishedAt,
      });
      const collectedAt = new Date();
      const repo = new SeasonScoreContextRepository(prisma);
      const before = await prisma.seasonMedianKeyDistributionSnapshot.findUnique({
        where: {
          seasonId_contentHash: { seasonId: regionInput.seasonId, contentHash: result.contentHash },
        },
        select: { id: true },
      });
      const snapshot = await repo.importDistribution({
        seasonId: regionInput.seasonId,
        source: RAIDER_IO_ADDON_DISTRIBUTION_SOURCE,
        provenance: result.sourceMetadata,
        sourceVersion: String(result.sourceMetadata.releaseTag ?? acquired.selected.tag),
        collectedAt,
        points: result.points,
        contentHash: result.contentHash,
      });
      await prisma.scoreContextKeyDistributionRefresh.update({
        where: { id: refreshId },
        data: {
          status: "SUCCEEDED",
          finishedAt: new Date(),
          snapshotId: snapshot.id,
          errorMessage: null,
        },
      });
      await prisma.auditEvent.create({
        data: {
          id: randomUUID(),
          actorType: "system",
          action: "admin.score_context.key_distribution.refresh.succeeded",
          resourceType: "season_median_key_distribution_snapshot",
          resourceId: snapshot.id,
          metadata: {
            seasonId: regionInput.seasonId,
            region,
            releaseTag: acquired.selected.tag,
            eligibleCharacters: result.population.eligibleCharacters,
            snapshotId: snapshot.id,
            reused: Boolean(before),
          },
        },
      });
      return { snapshotId: snapshot.id, reused: Boolean(before), skipped: false, downloads };
    } catch (error) {
      const historical = Boolean(season && !season.isCurrent);
      if (historical && isDungeonIdentityError(error)) {
        const message =
          "NOT_CURRENT_SOURCE: addon dungeon identity does not match pinned historical season";
        await prisma.scoreContextKeyDistributionRefresh.update({
          where: { id: refreshId },
          data: { status: "SKIPPED", finishedAt: new Date(), errorMessage: message.slice(0, 2000) },
        });
        logger.info({ region, seasonId: regionInput.seasonId }, message);
        return { snapshotId: null, reused: false, skipped: true, downloads };
      }
      const message = error instanceof Error ? error.message : String(error);
      await prisma.scoreContextKeyDistributionRefresh.update({
        where: { id: refreshId },
        data: { status: "FAILED", finishedAt: new Date(), errorMessage: message.slice(0, 2000) },
      });
      await prisma.auditEvent.create({
        data: {
          id: randomUUID(),
          actorType: "system",
          action: "admin.score_context.key_distribution.refresh.failed",
          resourceType: "score_context_key_distribution_refresh",
          resourceId: refreshId,
          outcome: "FAILURE",
          metadata: { seasonId: regionInput.seasonId, region, error: message.slice(0, 500) },
        },
      });
      throw error;
    }
  }

  return {
    refreshRegion,
    downloadCount: () => downloads,
  };
}

export async function withSharedAddonIngestSession<T>(
  input: {
    prisma: PrismaClient;
    logger: Logger;
    fetchImpl?: typeof fetch;
    hooks?: KeyDistributionRefreshHooks;
  },
  fn: (session: ReturnType<typeof createSharedAddonIngestSession>) => Promise<T>,
): Promise<T> {
  return withTempDir(async (workingDir) => {
    const session = createSharedAddonIngestSession({ ...input, workingDir });
    return fn(session);
  });
}

export async function runKeyDistributionRefresh(input: {
  prisma: PrismaClient;
  logger: Logger;
  refreshId: string;
  seasonId: string;
  region: KeyDistributionRegion;
  fetchImpl?: typeof fetch;
  hooks?: KeyDistributionRefreshHooks;
}): Promise<{ snapshotId: string | null; reused: boolean }> {
  return withSharedAddonIngestSession(input, async (session) => {
    const result = await session.refreshRegion({
      seasonId: input.seasonId,
      regionCode: input.region,
      refreshId: input.refreshId,
    });
    return { snapshotId: result.snapshotId, reused: result.reused };
  });
}

export async function ingestFromLocalAddonFiles(input: {
  prisma: PrismaClient;
  seasonId: string;
  lookupLuaPath: string;
  charactersLuaPath: string;
  dungeonsLuaPath: string;
  tocText?: string | null;
  releaseTag: string;
  assetName: string;
  assetSha256: string;
}): Promise<{ snapshotId: string }> {
  const expected = await loadExpectedSeasonDungeons(input.prisma, input.seasonId);
  const regionRow = await input.prisma.season.findUnique({
    where: { id: input.seasonId },
    select: { region: { select: { code: true } } },
  });
  const regionCode = regionRow?.region?.code ?? "EU";
  const result = await ingestMythicPlusAddonFiles({
    regionCode,
    lookupLuaPath: input.lookupLuaPath,
    charactersLuaPath: input.charactersLuaPath,
    dungeonsLuaPath: input.dungeonsLuaPath,
    tocText: input.tocText,
    expectedDungeons: expected,
    releaseTag: input.releaseTag,
    assetName: input.assetName,
    assetSha256: input.assetSha256,
  });
  const snapshot = await new SeasonScoreContextRepository(input.prisma).importDistribution({
    seasonId: input.seasonId,
    source: RAIDER_IO_ADDON_DISTRIBUTION_SOURCE,
    provenance: result.sourceMetadata,
    sourceVersion: input.releaseTag,
    collectedAt: new Date(),
    points: result.points,
    contentHash: result.contentHash,
  });
  return { snapshotId: snapshot.id };
}

async function loadExpectedSeasonDungeons(
  prisma: PrismaClient,
  seasonId: string,
): Promise<SeasonDungeonIdentity[]> {
  const rows = await prisma.seasonDungeon.findMany({
    where: { seasonId },
    include: { dungeon: true },
    orderBy: { sortOrder: "asc" },
  });
  return rows.map((row) => ({
    slug: row.dungeon.slug,
    name: row.dungeon.name,
    mapId: row.dungeon.mapId,
    raiderioSlug: row.dungeon.raiderioSlug,
  }));
}
