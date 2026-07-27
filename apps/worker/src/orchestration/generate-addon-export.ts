import type { AddonExport } from "@mplus/database";
import type { GenerateAddonExportJob, RegionCode } from "@mplus/contracts";
import {
  buildAddonExportInputsFromSnapshots,
  getDefaultPaths,
  runExport,
} from "@mplus/addon-exporter";
import { getMetricsRegistry } from "@mplus/observability";
import type { WorkerContainer } from "../container.js";
import { ensureRegion } from "../persistence/realm-repository.js";
import { pruneRawArtifacts } from "../prune-artifacts.js";

/** Builds addon Lua shards from persisted score snapshots and records export metadata. */
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
        include: {
          realm: true,
          region: true,
          runParticipants: { where: { isTargetCharacter: true } },
        },
      },
    },
  });

  const generatedAt = new Date();
  const records = buildAddonExportInputsFromSnapshots(
    snapshots.map((snapshot) => ({
      overallScore: Number(snapshot.overallScore),
      grade: snapshot.grade,
      confidence: Number(snapshot.confidence),
      calculatedAt: snapshot.calculatedAt,
      character: snapshot.character,
      runCount: snapshot.character.runParticipants.length,
    })),
  );

  const { addonDir } = getDefaultPaths();
  const exportResult = runExport({
    addonDir,
    generatedAt: generatedAt.toISOString(),
    records,
    context: {
      region: region.code as RegionCode,
      seasonSlug: season.slug,
      scoreModelKey: model.key,
      scoreModelVersion: model.version,
      generatedAt: generatedAt.toISOString(),
      formatVersion: 1,
    },
  });

  getMetricsRegistry().recordAddonExport(
    exportResult.meta.characterCount,
    exportResult.shardFiles.length * 1024,
  );

  const addonExport = await repositories.addonExport.create({
    regionId: region.id,
    seasonId: job.seasonId,
    scoreModelId: model.id,
    generatedAt,
    characterCount: exportResult.meta.characterCount,
    formatVersion: String(exportResult.meta.formatVersion),
    checksum: exportResult.meta.checksum,
    status: "READY",
    metadata: {
      shardCount: exportResult.shardFiles.length,
      shardFiles: exportResult.shardFiles,
      persistedSnapshotCount: snapshots.length,
    },
  });

  await pruneRawArtifacts(prisma, env.RAW_ARTIFACT_RETENTION_DAYS, generatedAt);

  return addonExport;
}
