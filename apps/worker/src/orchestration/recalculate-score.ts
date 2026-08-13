import {
  ExternalApiError,
  type MythicRunDTO,
  type RecalculateScoreJob,
  type ScoreSnapshotDTO,
} from "@mplus/contracts";
import type { WorkerContainer } from "../container.js";
import { resolveActiveRefreshContract } from "./build-refresh-contract.js";
import { requirePersistedCatalogWclZoneId } from "./active-mplus-season/catalog-metadata.js";
import { runAuthoritativeScoring } from "./scoring/refresh-bridge.js";
import { mythicRunToEvidenceCandidateMetadataList } from "@mplus/scoring";
import {
  buildCandidatesFromPersistedDigests,
  mergeEvidenceCandidates,
} from "./scoring/digest-candidates.js";

/**
 * Recomputes a character's score via scoreCharacter (provider-free when live calls are off).
 * No legacy calculateScore path.
 */
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

  const characterIdentity = await container.prisma.character.findUnique({
    where: { id: job.characterId },
    include: { gameClass: true, activeSpec: true },
  });
  const classSlug = characterIdentity?.gameClass?.slug ?? null;
  const specSlug = characterIdentity?.activeSpec?.slug ?? null;
  const roleFromSpec = characterIdentity?.activeSpec?.role ?? null;
  const role =
    (roleFromSpec as "DPS" | "TANK" | "HEALER" | null) ??
    (character.role as "DPS" | "TANK" | "HEALER" | "UNKNOWN" | null) ??
    "UNKNOWN";

  const model = await repositories.score.getModelByKeyVersion(
    job.scoreModelKey,
    job.scoreModelVersion,
  );
  if (!model) {
    throw new Error(`Score model ${job.scoreModelKey}@${job.scoreModelVersion} not found`);
  }

  const season = await container.prisma.season.findUnique({ where: { id: job.seasonId } });
  if (!season) {
    throw new Error(`Season ${job.seasonId} not found`);
  }

  const now = new Date();
  const wclZoneId = requirePersistedCatalogWclZoneId(season);
  const { contract: refreshContract, hash: refreshContractHash } =
    resolveActiveRefreshContract({
      scoringModelKey: model.key,
      scoringModelVersion: model.version,
      activeSeasonId: season.slug,
      providerMode: container.env.PROVIDER_MODE,
      zoneId: wclZoneId,
    });

  const region = await container.prisma.region.findUnique({
    where: { id: character.regionId },
  });
  const realm = await container.prisma.realm.findUnique({
    where: { id: character.realmId },
  });
  if (!region || !realm) {
    throw new Error(`Character ${job.characterId} missing region/realm`);
  }

  const seasonDungeons = await container.prisma.seasonDungeon.findMany({
    where: { seasonId: season.id },
    include: { dungeon: true },
  });
  const activeDungeonSlugs = seasonDungeons.map((d) => d.dungeon.slug);

  const participants = await container.prisma.runParticipant.findMany({
    where: { characterId: job.characterId, run: { seasonId: job.seasonId } },
    include: {
      run: {
        include: {
          dungeon: true,
          sources: true,
        },
      },
    },
    take: 200,
  });

  const runCandidates = participants.flatMap((p) => {
    const run = p.run;
    const dto = {
      id: run.id,
      dungeonSlug: run.dungeon.slug,
      keyLevel: run.keyLevel,
      timed: run.timed,
      scoreValue: run.scoreValue,
      completedAt: run.completedAt.toISOString(),
      durationMs: run.durationMs,
      sources: run.sources.map((s) => ({
        provider: s.provider,
        reportCode: s.reportCode,
        fightId: s.fightId,
        revision: s.revision ?? null,
      })),
    } as unknown as MythicRunDTO;
    return mythicRunToEvidenceCandidateMetadataList(dto);
  });

  const digestCandidates = await buildCandidatesFromPersistedDigests({
    prisma: container.prisma,
    characterId: job.characterId,
  });
  const candidates = mergeEvidenceCandidates(runCandidates, digestCandidates);

  const outcome = await runAuthoritativeScoring({
    container,
    characterId: job.characterId,
    seasonId: season.id,
    seasonSlug: season.slug,
    role,
    classSlug,
    specSlug,
    refreshContract,
    evidenceCutoffAt: now.toISOString(),
    highKeyPolicyId: "high-key-policy-v1",
    activeDungeonSlugs,
    candidates,
    scoreModelKey: model.key,
    scoreModelVersion: model.version,
    scoreModelId: model.id,
    calculatedAt: now.toISOString(),
    region: region.code,
    realm: realm.slug,
    characterName: character.displayName,
  });

  const explanationBase =
    outcome.snapshot.explanation && typeof outcome.snapshot.explanation === "object"
      ? (outcome.snapshot.explanation as Record<string, unknown>)
      : {};

  const enriched: ScoreSnapshotDTO = {
    ...outcome.snapshot,
    explanation: {
      ...explanationBase,
      refreshContract,
      refreshContractHash,
    },
  };

  if (container.env.SCORING_PUBLICATION_ENABLED && !outcome.disabled) {
    await repositories.score.saveScoreSnapshot({
      characterId: job.characterId,
      seasonId: job.seasonId,
      scoreModelId: model.id,
      scopeType: "CHARACTER",
      scopeKey: null,
      snapshot: enriched,
      publish: true,
      refreshContractHash,
    });
  }

  return enriched;
}
