import {
  ExternalApiError,
  hashRefreshContract,
  type RecalculateScoreJob,
  type ScoreModelConfig,
  type ScoreSnapshotDTO,
} from "@mplus/contracts";
import type { WorkerContainer } from "../container.js";
import { fingerprintObservations } from "./fingerprint.js";
import { resolveActiveRefreshContract } from "./build-refresh-contract.js";

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

  const { contract: refreshContract, hash: refreshContractHash } = resolveActiveRefreshContract({
    scoringModelKey: model.key,
    scoringModelVersion: model.version,
    activeSeasonId: season.slug,
    providerMode: container.env.PROVIDER_MODE,
    env: process.env,
  });

  const scoreDto = container.calculateScore({
    characterId: job.characterId,
    seasonSlug: season.slug,
    model: model.config as unknown as ScoreModelConfig,
    scopeType: "CHARACTER",
    scopeKey: null,
    observations,
    calculatedAt: now.toISOString(),
    inputFingerprint: fingerprintObservations(
      job.characterId,
      model.key,
      model.version,
      observations,
      { refreshContract },
    ),
  });

  const explanationBase =
    scoreDto.explanation && typeof scoreDto.explanation === "object"
      ? (scoreDto.explanation as Record<string, unknown>)
      : {};

  const enriched: ScoreSnapshotDTO = {
    ...scoreDto,
    explanation: {
      ...explanationBase,
      refreshContract,
      refreshContractHash,
    },
  };

  const explanationHash = hashRefreshContract(refreshContract);
  if (explanationHash !== refreshContractHash) {
    throw new Error(
      `RECALCULATE_CONTRACT_HASH_MISMATCH: computed=${refreshContractHash} explanation=${explanationHash}`,
    );
  }

  await repositories.score.saveScoreSnapshot({
    characterId: job.characterId,
    seasonId: job.seasonId,
    scoreModelId: model.id,
    scopeType: "CHARACTER",
    scopeKey: null,
    snapshot: enriched,
    refreshContractHash,
  });

  return enriched;
}
