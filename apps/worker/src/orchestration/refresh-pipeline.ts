import { randomUUID } from "node:crypto";
import type { Character, IngestionJob } from "@mplus/database";
import { normalizeRegion } from "@mplus/domain";
import {
  ExternalApiError,
  type CharacterIdentityInput,
  type MetricObservationDTO,
  type MythicRunDTO,
  type ProviderFetchContext,
  type RefreshCharacterJob,
  type ScoreModelConfig,
  type ScoreSnapshotDTO,
} from "@mplus/contracts";
import type { WorkerContainer } from "../container.js";
import { refreshCharacterDedupeKey } from "../dedupe.js";
import { negativeCache } from "../negative-cache.js";
import { ensureCurrentSeason } from "../persistence/run-repository.js";
import { fingerprintObservations } from "./fingerprint.js";
import { classifyError, isSoftSkip } from "./retry-classification.js";

export const REFRESH_STAGES = [
  "resolve-character",
  "refresh-blizzard",
  "refresh-raiderio",
  "refresh-warcraftlogs-summary",
  "match-detailed-runs",
  "analyze-run",
  "extract-metrics",
  "calculate-score",
  "refresh-character-finalize",
] as const;

export type RefreshStage = (typeof REFRESH_STAGES)[number];

export interface RefreshPipelineResult {
  character: Character;
  job: IngestionJob;
  score: ScoreSnapshotDTO | null;
  stagesSkipped: RefreshStage[];
  notFound: boolean;
}

function toIdentity(job: RefreshCharacterJob): CharacterIdentityInput {
  return { region: job.region, realmSlug: job.realmSlug, name: job.name };
}

function buildContext(job: RefreshCharacterJob, now: Date): ProviderFetchContext {
  return {
    region: normalizeRegion(job.region),
    requestId: randomUUID(),
    correlationId: null,
    forceRefresh: job.forceRefresh,
    now: now.toISOString(),
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Runs the full refresh DAG synchronously (no BullMQ). Used directly by tests and by the
 * `refresh-character` queue processor — analyze-run executes inline for simplicity, matching
 * the fixture-mode allowance in the orchestration plan.
 */
export async function runRefreshPipeline(
  container: WorkerContainer,
  jobPayload: RefreshCharacterJob,
): Promise<RefreshPipelineResult> {
  const { repositories, providers, disabledProviders, logger } = container;
  const identity = toIdentity(jobPayload);
  const now = new Date();
  const ctx = buildContext(jobPayload, now);
  const stagesSkipped: RefreshStage[] = [];

  const dedupeKey = refreshCharacterDedupeKey(jobPayload);
  const { job: createdJob } = await repositories.job.createOrGetByDedupe({
    jobType: "refresh-character",
    dedupeKey,
    payload: jobPayload,
  });
  let job = await repositories.job.markActive(createdJob.id);

  if (negativeCache.has(identity) && !jobPayload.forceRefresh) {
    job = await repositories.job.markFailed(job.id, new Error("negative cache hit: identity not found"));
    throw new ExternalApiError({
      message: `Character ${identity.name} is negatively cached as NOT_FOUND`,
      code: "NOT_FOUND",
      provider: "blizzard",
      retryable: false,
    });
  }

  // 1. resolve-character
  let character = await repositories.character.upsertCharacter(identity, { displayName: jobPayload.name });
  job = await repositories.job.attachCharacter(job.id, character.id);

  const handleStageError = async (stage: RefreshStage, error: unknown): Promise<boolean> => {
    if (error instanceof ExternalApiError && error.code === "NOT_FOUND") {
      negativeCache.set(identity);
      await repositories.job.markFailed(job.id, error);
      logger.warn({ stage, identity }, "refresh pipeline: character not found upstream");
      throw error;
    }
    if (isSoftSkip(error)) {
      stagesSkipped.push(stage);
      logger.info({ stage, identity }, "refresh pipeline: provider disabled, soft-skipping stage");
      return true;
    }
    const classification = classifyError(error);
    logger.error({ stage, identity, err: error, classification }, "refresh pipeline: stage failed");
    await repositories.job.markFailed(job.id, error);
    throw error;
  };

  let mythicKeystoneScore: number | null = null;
  let mythicKeystoneBestKeyLevel: number | null = null;

  // 2. refresh-blizzard
  if (disabledProviders.has("blizzard")) {
    stagesSkipped.push("refresh-blizzard");
  } else {
    try {
      const profile = await providers.blizzard.getCharacterProfile(identity, ctx);
      character = await repositories.character.applyProviderProfile(character.id, profile.data);

      const equipment = await providers.blizzard.getCharacterEquipment(identity, ctx);
      await repositories.character.recordSnapshot(character.id, equipment.data, {
        averageItemLevel: equipment.data.itemLevelEquipped,
        equippedItemLevel: equipment.data.itemLevelEquipped,
      });

      const keystoneProfile = await providers.blizzard.getMythicKeystoneProfile(identity, ctx);
      mythicKeystoneScore = keystoneProfile.data.currentMythicRating;
      // Detailed run levels come from season profile / other providers; index profile is rating-focused.
      mythicKeystoneBestKeyLevel = null;

      await repositories.externalRequest.recordRequestAndPayload({
        provider: "blizzard",
        requestFingerprint: profile.metadata.requestFingerprint,
        endpointKey: profile.metadata.endpointKey,
        method: "GET",
        requestedAt: new Date(profile.metadata.requestedAt),
        completedAt: profile.metadata.completedAt ? new Date(profile.metadata.completedAt) : null,
        statusCode: profile.metadata.statusCode,
        payload: profile.data,
      });
    } catch (error) {
      await handleStageError("refresh-blizzard", error);
    }
  }

  // 3. refresh-raiderio
  if (disabledProviders.has("raiderio")) {
    stagesSkipped.push("refresh-raiderio");
  } else {
    try {
      const profile = await providers.raiderio.getCharacterProfile(identity, ctx);
      const data = profile.data as { profileUrl?: string };
      if (data.profileUrl) {
        character = await repositories.character.updateRaiderioProfile(character.id, data.profileUrl);
      }
    } catch (error) {
      await handleStageError("refresh-raiderio", error);
    }
  }

  // 4. refresh-warcraftlogs-summary
  let discoveredRuns: MythicRunDTO[] = [];
  if (disabledProviders.has("warcraftlogs")) {
    stagesSkipped.push("refresh-warcraftlogs-summary");
  } else {
    try {
      const runsResult = await providers.warcraftlogs.discoverCharacterRuns(identity, ctx);
      discoveredRuns = runsResult.data;
      for (const run of discoveredRuns) {
        await repositories.run.upsertRunWithSourcesAndParticipants(run, {
          regionCode: identity.region,
          targetCharacterId: character.id,
        });
      }
    } catch (error) {
      await handleStageError("refresh-warcraftlogs-summary", error);
    }
  }

  // 5. match-detailed-runs (LATEST + HIGHEST, deduped by run id)
  const [latestRun, highestRun] = await Promise.all([
    repositories.run.findLatestForCharacter(character.id),
    repositories.run.findHighestForCharacter(character.id),
  ]);
  const selectedRuns = new Map<string, typeof latestRun>();
  if (latestRun) selectedRuns.set(latestRun.id, latestRun);
  if (highestRun) selectedRuns.set(highestRun.id, highestRun);

  // 6. analyze-run (inline, per fixture-mode simplicity allowance)
  const analysisSummaries: Array<{ deaths: number; interruptsSucceeded: number; interruptsAssigned: number }> = [];
  if (!disabledProviders.has("warcraftlogs") && selectedRuns.size > 0) {
    for (const run of selectedRuns.values()) {
      if (!run) continue;
      const source = await repositories.run.findWclSource(run.id);
      if (!source) continue;

      try {
        const details = await providers.warcraftlogs.getReportFightDetails(
          source.reportCode,
          source.fightId,
          ctx,
        );
        const summary = details.data as {
          deaths: number;
          interruptsSucceeded: number;
          interruptsAssigned: number;
        };
        analysisSummaries.push(summary);
        await repositories.run.upsertRunAnalysis({
          runId: run.id,
          characterId: character.id,
          analysisVersion: "fixture-v1",
          analyzedAt: now,
          coverage: 1,
          summary,
        });
      } catch (error) {
        await handleStageError("analyze-run", error);
      }
    }
  } else {
    stagesSkipped.push("analyze-run");
  }

  // 7. extract-metrics
  const observedAt = now.toISOString();
  const observations: MetricObservationDTO[] = [];

  if (mythicKeystoneScore !== null) {
    observations.push({
      metricKey: "performance.spec_percentile",
      dimension: "PERFORMANCE",
      rawValue: mythicKeystoneScore,
      normalizedValue: clamp01(mythicKeystoneScore / 3200) * 100,
      confidence: 0.8,
      observedAt,
      sourceProvider: "blizzard",
      coverage: null,
      context: { source: "mythic-keystone-profile" },
    });
  }

  if (mythicKeystoneBestKeyLevel !== null) {
    observations.push({
      metricKey: "raid.mythic_progression",
      dimension: "RAID",
      rawValue: mythicKeystoneBestKeyLevel,
      normalizedValue: clamp01(mythicKeystoneBestKeyLevel / 20) * 100,
      confidence: 0.5,
      observedAt,
      sourceProvider: "blizzard",
      coverage: null,
      context: { source: "mythic-keystone-profile" },
    });
  }

  if (analysisSummaries.length > 0) {
    const avgDeaths =
      analysisSummaries.reduce((sum, s) => sum + s.deaths, 0) / analysisSummaries.length;
    observations.push({
      metricKey: "survival.death_rate",
      dimension: "SURVIVAL",
      rawValue: avgDeaths,
      normalizedValue: clamp01(1 - avgDeaths / 5) * 100,
      confidence: 0.7,
      observedAt,
      sourceProvider: "warcraftlogs",
      coverage: { present: analysisSummaries.length, expected: selectedRuns.size, ratio: 1 },
      context: { analyzedRuns: analysisSummaries.length },
    });

    const totalAssigned = analysisSummaries.reduce((sum, s) => sum + s.interruptsAssigned, 0);
    const totalSucceeded = analysisSummaries.reduce((sum, s) => sum + s.interruptsSucceeded, 0);
    observations.push({
      metricKey: "utility.interrupt_success",
      dimension: "UTILITY",
      rawValue: totalSucceeded,
      normalizedValue: totalAssigned > 0 ? clamp01(totalSucceeded / totalAssigned) * 100 : null,
      confidence: totalAssigned > 0 ? 0.7 : 0.2,
      observedAt,
      sourceProvider: "warcraftlogs",
      coverage: { present: analysisSummaries.length, expected: selectedRuns.size, ratio: 1 },
      context: { totalAssigned, totalSucceeded },
    });
  }

  observations.push({
    metricKey: "experience.run_volume",
    dimension: "EXPERIENCE",
    rawValue: discoveredRuns.length,
    normalizedValue: clamp01(discoveredRuns.length / 20) * 100,
    confidence: discoveredRuns.length > 0 ? 0.6 : 0.1,
    observedAt,
    sourceProvider: "warcraftlogs",
    coverage: null,
    context: { discoveredRuns: discoveredRuns.length },
  });

  observations.push({
    metricKey: "authenticity.suspicion_index",
    dimension: "AUTHENTICITY",
    rawValue: 0,
    normalizedValue: 100,
    confidence: 0.5,
    observedAt,
    sourceProvider: "blizzard",
    coverage: null,
    context: { note: "neutral placeholder pending Agent 4 detection rules" },
  });

  const season = await ensureCurrentSeason(container.prisma, character.regionId);
  await repositories.metric.replaceObservations(character.id, season.id, observations);

  // 8. calculate-score
  const model = await repositories.score.getActiveModel(container.env.ACTIVE_SCORE_MODEL_KEY);
  if (!model) {
    const error = new Error(`No active score model found for key "${container.env.ACTIVE_SCORE_MODEL_KEY}"`);
    await repositories.job.markFailed(job.id, error);
    throw error;
  }

  const scoreDto = container.calculateScore({
    characterId: character.id,
    seasonSlug: season.slug,
    model: model.config as unknown as ScoreModelConfig,
    scopeType: "CHARACTER",
    scopeKey: null,
    observations,
    calculatedAt: now.toISOString(),
    inputFingerprint: fingerprintObservations(character.id, model.key, model.version, observations),
  });

  await repositories.score.saveScoreSnapshot({
    characterId: character.id,
    seasonId: season.id,
    scoreModelId: model.id,
    scopeType: "CHARACTER",
    scopeKey: null,
    snapshot: scoreDto,
  });

  // 9. refresh-character-finalize
  character = await repositories.character.updateRefreshTimestamps(character.id, {
    lastSeenAt: now,
    lastPublicRefreshAt: now,
  });
  job = await repositories.job.markCompleted(job.id);

  return { character, job, score: scoreDto, stagesSkipped, notFound: false };
}
