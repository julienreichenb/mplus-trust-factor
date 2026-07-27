import { ExternalApiError, type RecalculateScoreJob, type ScoreModelConfig, type ScoreSnapshotDTO } from "@mplus/contracts";
import type { WorkerContainer } from "../container.js";
import { fingerprintObservations } from "./fingerprint.js";

/** Recomputes a character's score from already-persisted metric observations (no provider calls). */
export async function runRecalculateScore(
  container: WorkerContainer,
  job: RecalculateScoreJob,
): Promise<ScoreSnapshotDTO> {
  const { repositories } = container;

  const character = await repositories.character.findById(job.characterId);
  if (!character) {
    throw new ExternalApiError({
      message: `Character ${job.characterId} not found`,
      code: "NOT_FOUND",
      provider: "blizzard",
      retryable: false,
    });
  }

  const model = await repositories.score.getModelByKeyVersion(job.scoreModelKey, job.scoreModelVersion);
  if (!model) {
    throw new Error(`Score model ${job.scoreModelKey}@${job.scoreModelVersion} not found`);
  }

  const season = await container.prisma.season.findUnique({ where: { id: job.seasonId } });
  if (!season) {
    throw new Error(`Season ${job.seasonId} not found`);
  }

  const observations = await repositories.metric.listForCharacter(job.characterId, job.seasonId);
  const now = new Date();

  const scoreDto = container.calculateScore({
    characterId: job.characterId,
    seasonSlug: season.slug,
    model: model.config as unknown as ScoreModelConfig,
    scopeType: "CHARACTER",
    scopeKey: null,
    observations,
    calculatedAt: now.toISOString(),
    inputFingerprint: fingerprintObservations(job.characterId, model.key, model.version, observations),
  });

  await repositories.score.saveScoreSnapshot({
    characterId: job.characterId,
    seasonId: job.seasonId,
    scoreModelId: model.id,
    scopeType: "CHARACTER",
    scopeKey: null,
    snapshot: scoreDto,
  });

  return scoreDto;
}
