import { randomUUID } from "node:crypto";
import { ADMIN_SCORING_DEFAULT_REGION, RAIDER_IO_ADDON_DISTRIBUTION_SOURCE } from "@mplus/contracts";
import { SeasonScoreContextRepository, type PrismaClient } from "@mplus/database";
import {
  downloadReleaseZip,
  extractRequiredAddonFiles,
  ingestEuMythicPlusAddonFiles,
  selectLatestMainlineAddonRelease,
  withTempDir,
  type SeasonDungeonIdentity,
} from "@mplus/provider-raiderio";
import type { Logger } from "@mplus/observability";

export async function runKeyDistributionRefresh(input: {
  prisma: PrismaClient;
  logger: Logger;
  refreshId: string;
  seasonId: string;
  region: typeof ADMIN_SCORING_DEFAULT_REGION;
  fetchImpl?: typeof fetch;
}): Promise<{ snapshotId: string; reused: boolean }> {
  const { prisma, logger, refreshId, seasonId, region } = input;
  const startedAt = new Date();
  await prisma.scoreContextKeyDistributionRefresh.update({
    where: { id: refreshId },
    data: { status: "RUNNING", startedAt, errorMessage: null },
  });
  try {
    const expected = await loadExpectedSeasonDungeons(prisma, seasonId);
    const result = await withTempDir(async (dir) => {
      const selected = await selectLatestMainlineAddonRelease(input.fetchImpl);
      logger.info({ tag: selected.tag, asset: selected.assetName }, "raiderio addon release selected");
      const { zipPath, sha256 } = await downloadReleaseZip(selected.assetUrl, dir, input.fetchImpl);
      const files = await extractRequiredAddonFiles(zipPath, dir);
      return ingestEuMythicPlusAddonFiles({
        lookupLuaPath: files.lookupPath,
        charactersLuaPath: files.charactersPath,
        dungeonsLuaPath: files.dungeonsPath,
        tocText: files.tocText,
        expectedDungeons: expected,
        releaseTag: selected.tag,
        assetName: selected.assetName,
        assetSha256: sha256,
        githubPublishedAt: selected.publishedAt,
      });
    });
    const collectedAt = new Date();
    const repo = new SeasonScoreContextRepository(prisma);
    const before = await prisma.seasonMedianKeyDistributionSnapshot.findUnique({
      where: { seasonId_contentHash: { seasonId, contentHash: result.contentHash } },
      select: { id: true },
    });
    const snapshot = await repo.importDistribution({
      seasonId,
      source: RAIDER_IO_ADDON_DISTRIBUTION_SOURCE,
      provenance: result.sourceMetadata,
      sourceVersion: String(result.sourceMetadata.releaseTag ?? ""),
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
          seasonId,
          region,
          releaseTag: String(result.sourceMetadata.releaseTag ?? ""),
          eligibleCharacters: result.population.eligibleCharacters,
          snapshotId: snapshot.id,
          reused: Boolean(before),
        },
      },
    });
    return { snapshotId: snapshot.id, reused: Boolean(before) };
  } catch (error) {
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
        metadata: { seasonId, region, error: message.slice(0, 500) },
      },
    });
    throw error;
  }
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
  const result = await ingestEuMythicPlusAddonFiles({
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
