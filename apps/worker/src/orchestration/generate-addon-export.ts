import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AddonExport } from "@mplus/database";
import type { GenerateAddonExportJob } from "@mplus/contracts";
import { renderAddonLua, type AddonExportEntry } from "@mplus/addon-exporter";
import type { WorkerContainer } from "../container.js";
import { ensureRegion } from "../persistence/realm-repository.js";
import { pruneRawArtifacts } from "../prune-artifacts.js";

/** Builds the AddonExport metadata row, writes a Lua shard, and prunes expired raw artifacts. */
export async function runGenerateAddonExport(
  container: WorkerContainer,
  job: GenerateAddonExportJob,
): Promise<AddonExport> {
  const { repositories, prisma, env } = container;

  const region = await ensureRegion(prisma, job.region);
  const model = await repositories.score.getModelByKeyVersion(job.scoreModelKey, job.scoreModelVersion);
  if (!model) {
    throw new Error(`Score model ${job.scoreModelKey}@${job.scoreModelVersion} not found`);
  }

  const season = await prisma.season.findUnique({ where: { id: job.seasonId } });
  if (!season) {
    throw new Error(`Season ${job.seasonId} not found`);
  }

  const snapshots = await prisma.scoreSnapshot.findMany({
    where: { seasonId: job.seasonId, scoreModelId: model.id },
    include: {
      character: {
        include: { realm: true, region: true },
      },
    },
  });

  const entries: AddonExportEntry[] = snapshots.map((snapshot) => ({
    region: snapshot.character.region.code,
    realmSlug: snapshot.character.realm.slug,
    normalizedName: snapshot.character.normalizedName,
    grade: snapshot.grade as AddonExportEntry["grade"],
    overallScore: Number(snapshot.overallScore),
    confidence: Number(snapshot.confidence),
  }));

  const generatedAt = new Date();
  const formatVersion = "v1";
  const checksum = createHash("sha256")
    .update(
      JSON.stringify({
        region: region.code,
        seasonId: job.seasonId,
        scoreModelId: model.id,
        characterCount: entries.length,
        generatedAt: generatedAt.toISOString(),
      }),
    )
    .digest("hex");

  const lua = renderAddonLua({
    formatVersion,
    generatedAt: generatedAt.toISOString(),
    region: region.code,
    seasonSlug: season.slug,
    modelKey: model.key,
    modelVersion: model.version,
    checksum,
    entries,
  });

  const outputDir = resolve(process.cwd(), "addon/MPlusTrust/Data");
  mkdirSync(outputDir, { recursive: true });
  const outputFile = resolve(outputDir, "MPlusTrustData.lua");
  writeFileSync(outputFile, lua, "utf8");

  const addonExport = await repositories.addonExport.create({
    regionId: region.id,
    seasonId: job.seasonId,
    scoreModelId: model.id,
    generatedAt,
    characterCount: entries.length,
    formatVersion,
    checksum,
    status: "READY",
    metadata: { outputFile, characterCount: entries.length },
  });

  await pruneRawArtifacts(prisma, env.RAW_ARTIFACT_RETENTION_DAYS, generatedAt);

  return addonExport;
}
