import { randomUUID } from "node:crypto";
import type { Character, IngestionJob } from "@mplus/database";
import { normalizeRegion } from "@mplus/domain";
import {
  ExternalApiError,
  type CharacterIdentityInput,
  type MetricObservationDTO,
  type MythicRunDTO,
  type ProviderFetchContext,
  type RaiderIoBoostSupportFacts,
  type RefreshCharacterJob,
  type ScoreModelConfig,
  type ScoreSnapshotDTO,
} from "@mplus/contracts";
import { extractBoostSupportFacts } from "@mplus/provider-raiderio";
import type { WclReportFightDetails, WclVisibilityState, RunCombatFacts } from "@mplus/provider-warcraftlogs";
import { validateScoreSnapshot } from "@mplus/test-utils";
import type { WorkerContainer } from "../container.js";
import { refreshCharacterDedupeKey } from "../dedupe.js";
import { negativeCache } from "../negative-cache.js";
import { ensureCurrentSeason } from "../persistence/run-repository.js";
import { mapBoostFactsToAuthenticity } from "./boost-authenticity.js";
import { extractMetricsFromCombatFacts } from "./combat-metrics.js";
import { fingerprintObservations } from "./fingerprint.js";
import { recordProviderResult } from "./provider-recording.js";
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

function isFixtureDisabledIdentity(identity: CharacterIdentityInput): boolean {
  return identity.name.toLocaleLowerCase("en-US").includes("disabled-test");
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

function isRaiderIoSkipped(container: WorkerContainer): boolean {
  return (
    container.disabledProviders.has("raiderio") ||
    ("enabled" in container.providers.raiderio && container.providers.raiderio.enabled === false)
  );
}

function resolveWclVisibility(
  provider: WorkerContainer["providers"]["warcraftlogs"],
  identity: CharacterIdentityInput,
  ctx: ProviderFetchContext,
): WclVisibilityState | null {
  if (
    "discoverCharacter" in provider &&
    typeof (provider as { discoverCharacter?: (i: CharacterIdentityInput, c: ProviderFetchContext) => { summary: { visibility: WclVisibilityState } } }).discoverCharacter === "function"
  ) {
    const discovery = (
      provider as {
        discoverCharacter: (
          i: CharacterIdentityInput,
          c: ProviderFetchContext,
        ) => { summary: { visibility: WclVisibilityState } };
      }
    ).discoverCharacter(identity, ctx);
    return discovery.summary.visibility;
  }
  return null;
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
  let boostFacts: RaiderIoBoostSupportFacts | null = null;
  let wclVisibility: WclVisibilityState | null = null;

  // 2. refresh-blizzard
  if (disabledProviders.has("blizzard") || isFixtureDisabledIdentity(identity)) {
    stagesSkipped.push("refresh-blizzard");
  } else {
    try {
      const profile = await providers.blizzard.getCharacterProfile(identity, ctx);
      character = await repositories.character.applyProviderProfile(character.id, profile.data);
      await recordProviderResult(repositories, profile);

      const equipment = await providers.blizzard.getCharacterEquipment(identity, ctx);
      await repositories.character.recordSnapshot(character.id, equipment.data, {
        averageItemLevel: equipment.data.itemLevelEquipped,
        equippedItemLevel: equipment.data.itemLevelEquipped,
      });
      await recordProviderResult(repositories, equipment);

      const keystoneProfile = await providers.blizzard.getMythicKeystoneProfile(identity, ctx);
      mythicKeystoneScore = keystoneProfile.data.currentMythicRating;
      mythicKeystoneBestKeyLevel = null;
      await recordProviderResult(repositories, keystoneProfile);
    } catch (error) {
      await handleStageError("refresh-blizzard", error);
    }
  }

  // 3. refresh-raiderio
  if (isRaiderIoSkipped(container) || isFixtureDisabledIdentity(identity)) {
    stagesSkipped.push("refresh-raiderio");
  } else {
    try {
      const profile = await providers.raiderio.getCharacterProfile(identity, ctx);
      boostFacts = extractBoostSupportFacts(profile.data);
      if (profile.data.profileUrl) {
        character = await repositories.character.updateRaiderioProfile(
          character.id,
          profile.data.profileUrl,
        );
      }
      await recordProviderResult(repositories, profile);
      await recordProviderResult(
        repositories,
        {
          ...profile,
          data: boostFacts,
          metadata: {
            ...profile.metadata,
            endpointKey: "extractBoostSupportFacts",
            requestFingerprint: `${profile.metadata.requestFingerprint}:boost-facts`,
          },
        },
      );
    } catch (error) {
      await handleStageError("refresh-raiderio", error);
    }
  }

  // 4. refresh-warcraftlogs-summary
  let discoveredRuns: MythicRunDTO[] = [];
  if (disabledProviders.has("warcraftlogs") || isFixtureDisabledIdentity(identity)) {
    stagesSkipped.push("refresh-warcraftlogs-summary");
  } else {
    try {
      wclVisibility = resolveWclVisibility(providers.warcraftlogs, identity, ctx);
      const runsResult = await providers.warcraftlogs.discoverCharacterRuns(identity, ctx);
      discoveredRuns = runsResult.data;
      await recordProviderResult(repositories, runsResult);
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
  const combatFactsList: RunCombatFacts[] = [];
  if (!disabledProviders.has("warcraftlogs") && selectedRuns.size > 0) {
    for (const run of selectedRuns.values()) {
      if (!run) continue;
      const source = await repositories.run.findWclSource(run.id);
      if (!source) continue;

      try {
        const detailsResult = await providers.warcraftlogs.getReportFightDetails(
          source.reportCode,
          source.fightId,
          ctx,
        );
        const details = detailsResult.data as WclReportFightDetails;
        const payloadId = await recordProviderResult(repositories, detailsResult);
        combatFactsList.push(details.combatFacts);

        const coverageRatio =
          Object.values(details.combatFacts.coverage).filter(Boolean).length /
          Object.keys(details.combatFacts.coverage).length;

        await repositories.run.upsertRunAnalysis({
          runId: run.id,
          characterId: character.id,
          analysisVersion: "wcl-combat-facts-v1",
          analyzedAt: now,
          coverage: coverageRatio,
          summary: {
            wclVisibility,
            combatFacts: {
              reportCode: details.combatFacts.reportCode,
              fightId: details.combatFacts.fightId,
              revision: details.combatFacts.revision,
              coverage: details.combatFacts.coverage,
              limitations: details.combatFacts.limitations,
              deathCount: details.combatFacts.deaths.length,
              interruptCount: details.combatFacts.interrupts.length,
            },
          },
          sourcePayloadIds: payloadId ? [payloadId] : [],
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

  for (const facts of combatFactsList) {
    observations.push(...extractMetricsFromCombatFacts(facts, observedAt));
  }

  if (discoveredRuns.length > 0) {
    observations.push({
      metricKey: "experience.run_volume",
      dimension: "EXPERIENCE",
      rawValue: discoveredRuns.length,
      normalizedValue: clamp01(discoveredRuns.length / 20) * 100,
      confidence: discoveredRuns.length > 0 ? 0.6 : 0.1,
      observedAt,
      sourceProvider: "warcraftlogs",
      coverage: null,
      context: { discoveredRuns: discoveredRuns.length, wclVisibility },
    });
  }

  const authenticityFeatures = boostFacts ? mapBoostFactsToAuthenticity(boostFacts) : undefined;
  const selectedRunCoverage =
    selectedRuns.size > 0 ? combatFactsList.length / selectedRuns.size : wclVisibility === "HIDDEN" ? 0.2 : 0;
  const freshness =
    wclVisibility === "HIDDEN" || wclVisibility === "NO_PUBLIC_LOGS" ? 0.35 : 0.75;

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
    context: {
      role: character.role ?? "DPS",
      freshness,
      selectedRunCoverage,
      authenticity: authenticityFeatures,
    },
  });

  const quality = validateScoreSnapshot(scoreDto, model.config as unknown as ScoreModelConfig);
  if (!quality.ok) {
    logger.warn(
      { characterId: character.id, violations: quality.violations },
      "refresh pipeline: score snapshot failed data-quality invariants",
    );
  }

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
