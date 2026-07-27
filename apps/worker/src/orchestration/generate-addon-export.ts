import { createHash } from "node:crypto";
import type { AddonExport } from "@mplus/database";
import type { GenerateAddonExportJob } from "@mplus/contracts";
import type { WorkerContainer } from "../container.js";
import { ensureRegion } from "../persistence/realm-repository.js";
import { pruneRawArtifacts } from "../prune-artifacts.js";

/** Builds the AddonExport metadata row and opportunistically prunes expired raw artifacts. */
export async function runGenerateAddonExport(
  container: WorkerContainer,
  job: GenerateAddonExportJob,
): Promise<AddonExport> {
  const { repositories, prisma } = container;

  const region = await ensureRegion(prisma, job.region);
  const model = await repositories.score.getModelByKeyVersion(job.scoreModelKey, job.scoreModelVersion);
  if (!model) {
    throw new Error(`Score model ${job.scoreModelKey}@${job.scoreModelVersion} not found`);
  }

  const characterCount = await prisma.scoreSnapshot.count({
    where: { seasonId: job.seasonId, scoreModelId: model.id },
  });

  const generatedAt = new Date();
  const formatVersion = "v1";
  const checksum = createHash("sha256")
    .update(
      JSON.stringify({
        region: region.code,
        seasonId: job.seasonId,
        scoreModelId: model.id,
        characterCount,
        generatedAt: generatedAt.toISOString(),
      }),
    )
    .digest("hex");

  const addonExport = await repositories.addonExport.create({
    regionId: region.id,
    seasonId: job.seasonId,
    scoreModelId: model.id,
    generatedAt,
    characterCount,
    formatVersion,
    checksum,
    status: "READY",
  });

  await pruneRawArtifacts(prisma, container.env.RAW_ARTIFACT_RETENTION_DAYS, generatedAt);

  return addonExport;
}
