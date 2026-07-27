import { randomUUID } from "node:crypto";
import type { Character, IngestionJob } from "@mplus/database";
import { normalizeRegion } from "@mplus/domain";
import {
  ExternalApiError,
  type CanonicalCharacter,
  type CharacterIdentityInput,
  type ExcludedObservationDTO,
  type MetricObservationDTO,
  type MythicRunDTO,
  type ProviderFetchContext,
  type RaiderIoBoostSupportFacts,
  type RaiderIoCharacterProfile,
  type RaiderIoSeasonCutoffs,
  type RefreshCharacterJob,
  type ScoreModelConfig,
  type ScoreSnapshotDTO,
  type SourceDisagreementDTO,
  type WclVisibilityState,
} from "@mplus/contracts";
import { extractBoostSupportFacts } from "@mplus/provider-raiderio";
import type { RunCombatFacts, WclReportFightDetails } from "@mplus/provider-warcraftlogs";
import { validateScoreSnapshot } from "@mplus/test-utils";
import type { WorkerContainer } from "../container.js";
import { refreshCharacterDedupeKey } from "../dedupe.js";
import { negativeCache } from "../negative-cache.js";
import { ensureCurrentSeason } from "../persistence/run-repository.js";
import { mapBoostFactsToAuthenticity } from "./boost-authenticity.js";
import { extractMetricsFromCombatFacts } from "./combat-metrics.js";
import { fingerprintObservations } from "./fingerprint.js";
import { buildMythicRatingObservation } from "./performance-metrics.js";
import { recordProviderResult } from "./provider-recording.js";
import {
  excludedLowConfidenceMatch,
  isEnrichmentSoftSkip,
  mapErrorToProviderState,
  mapWclVisibilityToState,
  reconcileSources,
} from "./reconcile.js";
import { classifyError, isSoftSkip } from "./retry-classification.js";
import { collectRaiderIoRuns, mergeRunSources } from "./run-fusion.js";

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
  disagreements: SourceDisagreementDTO[];
  excludedObservations: ExcludedObservationDTO[];
}

function toIdentity(job: RefreshCharacterJob): CharacterIdentityInput {
  return { region: job.region, realmSlug: job.realmSlug, name: job.name };
}

function isFixtureDisabledIdentity(identity: CharacterIdentityInput): boolean {
  return identity.name.toLocaleLowerCase("en-US").includes("disabled-test");
}

function buildContext(job: RefreshCharacterJob, now: Date): ProviderFetchContext {
  const identity = toIdentity(job);
  return {
    region: normalizeRegion(job.region),
    requestId: randomUUID(),
    correlationId: null,
    forceRefresh: job.forceRefresh,
    now: now.toISOString(),
    targetCharacter: identity,
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
    "discoverCharacterSummary" in provider &&
    typeof provider.discoverCharacterSummary === "function"
  ) {
    // Sync fixture helpers may return a plain object; live returns a Promise — handled by caller.
  }
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

function toPersistedCombatFacts(facts: RunCombatFacts) {
  return {
    reportCode: facts.reportCode,
    fightId: facts.fightId,
    revision: facts.revision,
    targetSourceId: facts.targetSourceId,
    coverage: facts.coverage,
    limitations: facts.limitations,
  };
}

/**
 * Runs the full refresh DAG synchronously (no BullMQ). Used directly by tests and by the
 * `refresh-character` queue processor — analyze-run executes inline for simplicity, matching
 * the fixture-mode allowance in the orchestration plan.
 *
 * Blizzard is the identity gate. Raider.IO and WCL enrichment run concurrently afterward and
 * soft-skip on failure so a Blizzard-backed provisional score can still persist.
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
  const disagreements: SourceDisagreementDTO[] = [];
  const excludedObservations: ExcludedObservationDTO[] = [];
  const fusionWarnings: string[] = [];

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

  let character = await repositories.character.upsertCharacter(identity, { displayName: jobPayload.name });
  job = await repositories.job.attachCharacter(job.id, character.id);

  const failHard = async (stage: RefreshStage, error: unknown): Promise<never> => {
    if (error instanceof ExternalApiError && error.code === "NOT_FOUND") {
      negativeCache.set(identity);
      await repositories.providerState.upsert({
        characterId: character.id,
        provider: "blizzard",
        state: "NOT_FOUND",
        detail: error.message,
        lastAttemptAt: now,
      });
    }
    const classification = classifyError(error);
    logger.error({ stage, identity, err: error, classification }, "refresh pipeline: stage failed");
    await repositories.job.markFailed(job.id, error);
    throw error;
  };

  let blizzardProfile: CanonicalCharacter | null = null;
  let blizzardItemLevel: number | null = null;
  let mythicKeystoneScore: number | null = null;
  let currentSeasonId: number | null = null;
  let blizzardRuns: MythicRunDTO[] = [];
  let raiderIoProfile: RaiderIoCharacterProfile | null = null;
  let seasonCutoffs: RaiderIoSeasonCutoffs | null = null;
  let boostFacts: RaiderIoBoostSupportFacts | null = null;
  let wclVisibility: WclVisibilityState | null = null;
  let discoveredRuns: MythicRunDTO[] = [];

  // ── Blizzard identity gate ──────────────────────────────────────────────
  if (disabledProviders.has("blizzard") || isFixtureDisabledIdentity(identity)) {
    stagesSkipped.push("refresh-blizzard");
    await repositories.providerState.upsert({
      characterId: character.id,
      provider: "blizzard",
      state: "UNAVAILABLE",
      detail: "provider disabled",
      lastAttemptAt: now,
    });
  } else {
    try {
      const profile = await providers.blizzard.getCharacterProfile(identity, ctx);
      blizzardProfile = profile.data;
      character = await repositories.character.applyProviderProfile(character.id, profile.data);
      await recordProviderResult(repositories, profile);

      const equipment = await providers.blizzard.getCharacterEquipment(identity, ctx);
      blizzardItemLevel = equipment.data.itemLevelEquipped;
      await repositories.character.recordSnapshot(character.id, equipment.data, {
        averageItemLevel: equipment.data.itemLevelEquipped,
        equippedItemLevel: equipment.data.itemLevelEquipped,
      });
      await recordProviderResult(repositories, equipment);

      const keystoneProfile = await providers.blizzard.getMythicKeystoneProfile(identity, ctx);
      mythicKeystoneScore = keystoneProfile.data.currentMythicRating;
      currentSeasonId = keystoneProfile.data.currentSeasonId;
      await recordProviderResult(repositories, keystoneProfile);

      if (currentSeasonId != null) {
        try {
          const seasonProfile = await providers.blizzard.getMythicKeystoneSeasonProfile(
            identity,
            currentSeasonId,
            ctx,
          );
          blizzardRuns = seasonProfile.data.runs;
          await recordProviderResult(repositories, seasonProfile);
        } catch (seasonError) {
          logger.info(
            { identity, err: seasonError },
            "refresh pipeline: Blizzard season profile optional fetch failed",
          );
        }
      }

      await repositories.providerState.upsert({
        characterId: character.id,
        provider: "blizzard",
        state: "OK",
        lastAttemptAt: now,
        lastSuccessAt: now,
        fetchedAt: now,
        expiresAt: keystoneProfile.freshness.expiresAt
          ? new Date(keystoneProfile.freshness.expiresAt)
          : null,
      });
    } catch (error) {
      if (isSoftSkip(error)) {
        stagesSkipped.push("refresh-blizzard");
        await repositories.providerState.upsert({
          characterId: character.id,
          provider: "blizzard",
          state: "UNAVAILABLE",
          detail: error instanceof Error ? error.message : "soft-skip",
          lastAttemptAt: now,
        });
      } else {
        await failHard("refresh-blizzard", error);
      }
    }
  }

  // ── Concurrent Raider.IO + WCL enrichment ───────────────────────────────
  type RaiderIoEnrichment = {
    profile: RaiderIoCharacterProfile | null;
    cutoffs: RaiderIoSeasonCutoffs | null;
    boost: RaiderIoBoostSupportFacts | null;
  };
  type WclEnrichment = {
    visibility: WclVisibilityState | null;
    runs: MythicRunDTO[];
  };

  const enrichRaiderIo = async (): Promise<RaiderIoEnrichment> => {
    if (isRaiderIoSkipped(container) || isFixtureDisabledIdentity(identity)) {
      stagesSkipped.push("refresh-raiderio");
      await repositories.providerState.upsert({
        characterId: character.id,
        provider: "raiderio",
        state: "UNAVAILABLE",
        detail: "provider disabled",
        lastAttemptAt: now,
      });
      return { profile: null, cutoffs: null, boost: null };
    }

    try {
      const profile = await providers.raiderio.getCharacterProfile(identity, ctx);
      const boost = extractBoostSupportFacts(profile.data);
      if (profile.data.profileUrl) {
        character = await repositories.character.updateRaiderioProfile(
          character.id,
          profile.data.profileUrl,
        );
      }
      await recordProviderResult(repositories, profile);
      await recordProviderResult(repositories, {
        ...profile,
        data: boost,
        metadata: {
          ...profile.metadata,
          endpointKey: "extractBoostSupportFacts",
          requestFingerprint: `${profile.metadata.requestFingerprint}:boost-facts`,
        },
      });

      let cutoffs: RaiderIoSeasonCutoffs | null = null;
      // Season cutoffs are optional and must remain non-blocking (live often HTTP 500).
      try {
        const seasonSlug =
          profile.data.currentSeason?.seasonSlug ??
          (await ensureCurrentSeason(container.prisma, character.regionId)).slug;
        const cutoffsResult = await providers.raiderio.getSeasonCutoffs(
          identity.region,
          seasonSlug,
          ctx,
        );
        cutoffs = cutoffsResult.data;
        await recordProviderResult(repositories, cutoffsResult);
        if (!cutoffsResult.data.top25Percent) {
          fusionWarnings.push("RAIDERIO_SEASON_CUTOFFS_UNAVAILABLE");
        }
      } catch (cutoffError) {
        fusionWarnings.push("RAIDERIO_SEASON_CUTOFFS_UNAVAILABLE");
        logger.info(
          { identity, err: cutoffError },
          "refresh pipeline: Raider.IO season-cutoffs non-blocking failure",
        );
      }

      await repositories.providerState.upsert({
        characterId: character.id,
        provider: "raiderio",
        state: profile.data.crawlStale ? "STALE" : "OK",
        warnings: profile.data.crawlStale ? ["CRAWL_STALE"] : [],
        lastAttemptAt: now,
        lastSuccessAt: now,
        fetchedAt: now,
        expiresAt: profile.freshness.expiresAt ? new Date(profile.freshness.expiresAt) : null,
        metadata: {
          raiderIoScore: profile.data.currentSeason?.scores.all ?? null,
          profileUrl: profile.data.profileUrl,
        },
      });
      return { profile: profile.data, cutoffs, boost };
    } catch (error) {
      if (isEnrichmentSoftSkip(error)) {
        stagesSkipped.push("refresh-raiderio");
        await repositories.providerState.upsert({
          characterId: character.id,
          provider: "raiderio",
          state: mapErrorToProviderState(error),
          detail: error instanceof Error ? error.message : "enrichment soft-skip",
          lastAttemptAt: now,
        });
        logger.info({ identity, err: error }, "refresh pipeline: Raider.IO soft-skipped");
        return { profile: null, cutoffs: null, boost: null };
      }
      return await failHard("refresh-raiderio", error);
    }
  };

  const enrichWarcraftLogs = async (): Promise<WclEnrichment> => {
    if (disabledProviders.has("warcraftlogs") || isFixtureDisabledIdentity(identity)) {
      stagesSkipped.push("refresh-warcraftlogs-summary");
      await repositories.providerState.upsert({
        characterId: character.id,
        provider: "warcraftlogs",
        state: "UNAVAILABLE",
        detail: "provider disabled",
        lastAttemptAt: now,
      });
      return { visibility: null, runs: [] };
    }

    let visibility: WclVisibilityState | null = null;
    try {
      if (
        "discoverCharacterSummary" in providers.warcraftlogs &&
        typeof providers.warcraftlogs.discoverCharacterSummary === "function"
      ) {
        const summary = await providers.warcraftlogs.discoverCharacterSummary!(identity, ctx);
        visibility = summary.data.visibility;
        await recordProviderResult(repositories, summary);
      } else {
        visibility = resolveWclVisibility(providers.warcraftlogs, identity, ctx);
      }

      const runsResult = await providers.warcraftlogs.discoverCharacterRuns(identity, ctx);
      await recordProviderResult(repositories, runsResult);

      await repositories.providerState.upsert({
        characterId: character.id,
        provider: "warcraftlogs",
        state: mapWclVisibilityToState(visibility),
        wclVisibility: visibility,
        lastAttemptAt: now,
        lastSuccessAt: now,
        fetchedAt: now,
        expiresAt: runsResult.freshness.expiresAt ? new Date(runsResult.freshness.expiresAt) : null,
        metadata: { discoveredRunCount: runsResult.data.length },
      });
      return { visibility, runs: runsResult.data };
    } catch (error) {
      if (isEnrichmentSoftSkip(error)) {
        stagesSkipped.push("refresh-warcraftlogs-summary");
        const state = mapErrorToProviderState(error);
        await repositories.providerState.upsert({
          characterId: character.id,
          provider: "warcraftlogs",
          state:
            state === "PRIVATE_OR_HIDDEN"
              ? "PRIVATE_OR_HIDDEN"
              : visibility
                ? mapWclVisibilityToState(visibility)
                : state,
          detail: error instanceof Error ? error.message : "enrichment soft-skip",
          wclVisibility: visibility,
          lastAttemptAt: now,
        });
        logger.info({ identity, err: error }, "refresh pipeline: WCL soft-skipped");
        return { visibility, runs: [] };
      }
      return await failHard("refresh-warcraftlogs-summary", error);
    }
  };

  const [rioEnrichment, wclEnrichment] = await Promise.all([
    enrichRaiderIo(),
    enrichWarcraftLogs(),
  ]);
  raiderIoProfile = rioEnrichment.profile;
  seasonCutoffs = rioEnrichment.cutoffs;
  boostFacts = rioEnrichment.boost;
  wclVisibility = wclEnrichment.visibility;
  discoveredRuns = wclEnrichment.runs;

  // ── Reconcile + fuse runs ───────────────────────────────────────────────
  const reconcile = reconcileSources({
    blizzard: blizzardProfile,
    blizzardItemLevel,
    raiderIo: raiderIoProfile,
    blizzardMythicRating: mythicKeystoneScore,
  });
  disagreements.push(...reconcile.disagreements);
  fusionWarnings.push(...reconcile.warnings);

  const rioRuns =
    raiderIoProfile != null
      ? collectRaiderIoRuns(raiderIoProfile.recentRuns, raiderIoProfile.bestRuns, identity)
      : [];
  const fusedRuns = mergeRunSources([...blizzardRuns, ...rioRuns, ...discoveredRuns]);

  for (const run of fusedRuns) {
    const hasWcl = run.sources.some((s) => s.provider === "WARCRAFT_LOGS");
    const hasExternal = run.sources.some(
      (s) => s.provider === "BLIZZARD" || s.provider === "RAIDER_IO",
    );

    // Near-miss cross-provider pairs (outside merge window) → exclude WCL combat attachment.
    if (hasWcl && !hasExternal) {
      const nearMiss = fusedRuns.find((other) => {
        if (other === run) return false;
        if (!other.sources.some((s) => s.provider === "BLIZZARD" || s.provider === "RAIDER_IO")) {
          return false;
        }
        if (other.dungeonSlug !== run.dungeonSlug) return false;
        if (Math.abs(other.keyLevel - run.keyLevel) > 1) return false;
        const delta = Math.abs(
          new Date(other.completedAt).getTime() - new Date(run.completedAt).getTime(),
        );
        return delta > 120_000 && delta <= 300_000;
      });
      if (nearMiss) {
        excludedObservations.push(
          excludedLowConfidenceMatch({
            runId: run.id,
            nearMissRunId: nearMiss.id,
            dungeonSlug: run.dungeonSlug,
            keyLevel: run.keyLevel,
            matchConfidence: "LOW",
          }),
        );
        run.sources = run.sources.filter((s) => s.provider !== "WARCRAFT_LOGS");
      }
    }

    await repositories.run.upsertRunWithSourcesAndParticipants(run, {
      regionCode: identity.region,
      targetCharacterId: character.id,
    });
  }

  if (disagreements.length > 0 || excludedObservations.length > 0 || fusionWarnings.length > 0) {
    await repositories.providerState.upsert({
      characterId: character.id,
      provider: "blizzard",
      state: blizzardProfile ? "OK" : "UNAVAILABLE",
      warnings: fusionWarnings,
      disagreements,
      excludedObservations,
      lastAttemptAt: now,
      lastSuccessAt: blizzardProfile ? now : null,
      fetchedAt: blizzardProfile ? now : null,
      metadata: { fusion: true },
    });
  }

  // ── Select + analyze detailed runs ──────────────────────────────────────
  const [latestRun, highestRun] = await Promise.all([
    repositories.run.findLatestForCharacter(character.id),
    repositories.run.findHighestForCharacter(character.id),
  ]);
  const selectedRuns = new Map<string, typeof latestRun>();
  if (latestRun) selectedRuns.set(latestRun.id, latestRun);
  if (highestRun) selectedRuns.set(highestRun.id, highestRun);

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
            combatFacts: toPersistedCombatFacts(details.combatFacts),
            deathCount: details.combatFacts.deaths.length,
            interruptCount: details.combatFacts.interrupts.length,
          },
          sourcePayloadIds: payloadId ? [payloadId] : [],
        });
      } catch (error) {
        if (isEnrichmentSoftSkip(error)) {
          stagesSkipped.push("analyze-run");
          logger.info({ identity, err: error }, "refresh pipeline: analyze-run soft-skipped");
          continue;
        }
        await failHard("analyze-run", error);
      }
    }
  } else {
    stagesSkipped.push("analyze-run");
  }

  // Character-level WCL visibility even when zero runs / no analysis target.
  if (wclVisibility !== null) {
    const visibilitySummary = { wclVisibility, discoveredRunCount: discoveredRuns.length };
    if (combatFactsList.length === 0) {
      const anyRun = latestRun ?? (await repositories.run.findLatestForCharacter(character.id));
      if (anyRun) {
        await repositories.run.upsertRunAnalysis({
          runId: anyRun.id,
          characterId: character.id,
          analysisVersion: "wcl-visibility-v1",
          analyzedAt: now,
          coverage: 0,
          summary: visibilitySummary,
          sourcePayloadIds: [],
        });
      } else {
        await repositories.providerState.upsert({
          characterId: character.id,
          provider: "warcraftlogs",
          state: mapWclVisibilityToState(wclVisibility),
          wclVisibility,
          lastAttemptAt: now,
          lastSuccessAt: now,
          fetchedAt: now,
          metadata: visibilitySummary,
        });
      }
    }
  }

  // ── Extract metrics ─────────────────────────────────────────────────────
  const observedAt = now.toISOString();
  const observations: MetricObservationDTO[] = [];

  if (mythicKeystoneScore !== null) {
    observations.push(
      buildMythicRatingObservation({
        mythicRating: mythicKeystoneScore,
        observedAt,
        cutoffs: seasonCutoffs,
      }),
    );
  }

  // Keep Raider.IO score as a separate non-product observation (never fed as product score).
  const rioScore = raiderIoProfile?.currentSeason?.scores.all ?? null;
  if (rioScore != null) {
    observations.push({
      metricKey: "source.raiderio_score",
      dimension: "EXPERIENCE",
      rawValue: rioScore,
      normalizedValue: null,
      confidence: raiderIoProfile?.crawlStale ? 0.4 : 0.7,
      observedAt,
      sourceProvider: "raiderio",
      coverage: null,
      context: {
        keptSeparateFromProductScore: true,
        ranks: raiderIoProfile?.ranks ?? null,
        profileUrl: raiderIoProfile?.profileUrl ?? null,
      },
    });
  }

  for (const facts of combatFactsList) {
    observations.push(...extractMetricsFromCombatFacts(facts, observedAt));
  }

  const runVolume = fusedRuns.length > 0 ? fusedRuns.length : discoveredRuns.length;
  if (runVolume > 0) {
    observations.push({
      metricKey: "experience.volume_recency",
      dimension: "EXPERIENCE",
      rawValue: runVolume,
      normalizedValue: clamp01(runVolume / 20) * 100,
      confidence: runVolume > 0 ? 0.6 : 0.1,
      observedAt,
      sourceProvider: discoveredRuns.length > 0 ? "warcraftlogs" : "fusion",
      coverage: null,
      context: {
        discoveredRuns: discoveredRuns.length,
        fusedRuns: fusedRuns.length,
        wclVisibility,
        derivedFrom: "run_volume",
      },
    });
  }

  const authenticityFeatures = boostFacts ? mapBoostFactsToAuthenticity(boostFacts) : undefined;
  const selectedRunCoverage =
    selectedRuns.size > 0
      ? combatFactsList.length / selectedRuns.size
      : wclVisibility === "HIDDEN" || wclVisibility === "NO_PUBLIC_LOGS"
        ? 0.2
        : 0;
  const freshness =
    wclVisibility === "HIDDEN" || wclVisibility === "NO_PUBLIC_LOGS"
      ? 0.35
      : stagesSkipped.includes("refresh-raiderio") || stagesSkipped.includes("refresh-warcraftlogs-summary")
        ? 0.55
        : 0.75;

  const season = await ensureCurrentSeason(container.prisma, character.regionId);
  await repositories.metric.replaceObservations(character.id, season.id, observations);

  // ── Calculate + structurally validate score ─────────────────────────────
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

  // Enrich explanation with fusion provenance (model version already present).
  const explanation =
    scoreDto.explanation && typeof scoreDto.explanation === "object"
      ? {
          ...(scoreDto.explanation as Record<string, unknown>),
          observations: observations.map((o) => ({
            metricKey: o.metricKey,
            sourceProvider: o.sourceProvider,
            observedAt: o.observedAt,
            confidence: o.confidence,
            rawValue: o.rawValue,
            normalizedValue: o.normalizedValue,
            context: o.context,
          })),
          providerTimestamps: {
            blizzard: blizzardProfile ? now.toISOString() : null,
            raiderio: raiderIoProfile ? now.toISOString() : null,
            warcraftlogs: wclVisibility ? now.toISOString() : null,
          },
          warnings: fusionWarnings,
          disagreements,
          excludedObservations,
          confidence: scoreDto.confidence,
          coverage: { selectedRunCoverage, freshness },
        }
      : scoreDto.explanation;

  const enrichedScore: ScoreSnapshotDTO = { ...scoreDto, explanation };

  const quality = validateScoreSnapshot(enrichedScore, model.config as unknown as ScoreModelConfig);
  if (!quality.ok) {
    logger.warn(
      { characterId: character.id, violations: quality.violations },
      "refresh pipeline: score snapshot failed structural data-quality invariants — blocking persistence",
    );
    const error = new Error(
      `Score snapshot failed structural validation: ${quality.violations.map((v) => v.code).join(", ")}`,
    );
    await repositories.job.markFailed(job.id, error);
    throw error;
  }

  await repositories.score.saveScoreSnapshot({
    characterId: character.id,
    seasonId: season.id,
    scoreModelId: model.id,
    scopeType: "CHARACTER",
    scopeKey: null,
    snapshot: enrichedScore,
  });

  character = await repositories.character.updateRefreshTimestamps(character.id, {
    lastSeenAt: now,
    lastPublicRefreshAt: now,
  });
  job = await repositories.job.markCompleted(job.id);

  return {
    character,
    job,
    score: enrichedScore,
    stagesSkipped,
    notFound: false,
    disagreements,
    excludedObservations,
  };
}
