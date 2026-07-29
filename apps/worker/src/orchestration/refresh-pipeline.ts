import { randomUUID } from "node:crypto";
import type { Character, IngestionJob } from "@mplus/database";
import { normalizeRegion } from "@mplus/domain";
import {
  ExternalApiError,
  hashRefreshContract,
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
  type WclDataState,
  refineWclDataState,
  normalizeWclProvenance,
} from "@mplus/contracts";
import { extractBoostSupportFacts } from "@mplus/provider-raiderio";
import type { RunCombatFacts, WclRankingObservation, WclReportFightDetails } from "@mplus/provider-warcraftlogs";
import {
  SURVIVAL_STANDALONE_V1_1_1_CONFIG,
  createSurvivalRequestCost,
} from "@mplus/provider-warcraftlogs";
import { buildCatalogCoverageDiagnostics, getAbilityCatalog } from "@mplus/abilities";
import {
  applyRunMetadataToSelection,
  buildCharacterHistoryExperienceObservations,
  readBlizzardSeasonDungeonSlugsFromMetadata,
  resolveActiveSeasonDungeonPool,
  selectScoringRuns,
  selectSurvivalAnalysisRuns,
  toContractScoringRunSelection,
} from "@mplus/scoring";
import { OBS_EVENTS, fingerprintIdentifier } from "@mplus/observability";
import { validateScoreSnapshot } from "@mplus/test-utils";
import {
  buildWclSummaryRequestFingerprint,
  isCompatiblePointsAndDamageSummary,
  POINTS_AND_DAMAGE_ADAPTER_VERSION,
  CURRENT_MPLUS_ZONE_DUNGEON_SLUGS,
  resolveMplusZoneConfig,
} from "@mplus/provider-warcraftlogs";
import type { WorkerContainer } from "../container.js";
import { refreshCharacterDedupeKey } from "../dedupe.js";
import { negativeCache } from "../negative-cache.js";
import { ensureBlizzardCurrentSeason, ensureCurrentSeason } from "../persistence/run-repository.js";
import { mapBoostFactsToAuthenticity } from "./boost-authenticity.js";
import { extractMetricsFromCombatFacts, isUsableCombatRun, buildRunCombatAdminDiagnostics } from "./combat-metrics.js";
import { aggregateCombatObservations } from "./aggregate-combat-observations.js";
import { bindParseToSelectedRun } from "./run-parse-binding.js";
import { fingerprintObservations, buildScoringRunSelectionKey } from "./fingerprint.js";
import { buildRefreshContract } from "./build-refresh-contract.js";
import { buildMythicRatingObservation } from "./performance-metrics.js";
import { buildWclPerformanceObservations } from "./wcl-performance-metrics.js";
import {
  expectedSurvivalCompatibilityKey,
  isCompatibleSurvivalSummary,
  type SurvivalRunAnalysisRow,
} from "./wcl-survival-metrics.js";
import { buildWclSurvivalObservations } from "./wcl-survival-metrics.js";
import { recordProviderResult } from "./provider-recording.js";
import type { WclDungeonPerformanceAggregateDTO } from "@mplus/contracts";
import {
  excludedLowConfidenceMatch,
  isEnrichmentSoftSkip,
  mapErrorToProviderState,
  mapWclVisibilityToState,
  reconcileSources,
} from "./reconcile.js";
import { classifyError, isSoftSkip } from "./retry-classification.js";
import {
  canonicalDungeonKey,
  collectRaiderIoRuns,
  ensureTargetParticipant,
  filterRunsToActiveWindow,
  fuseCrossProviderRuns,
} from "./run-fusion.js";
import {
  buildSurvivalWclBindPool,
  matchSurvivalWclSource,
} from "./survival-wcl-late-bind.js";
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
  const correlationId = job.correlationId?.trim() || null;
  const requestId = correlationId ?? randomUUID();
  return {
    region: normalizeRegion(job.region),
    requestId,
    correlationId,
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

/**
 * Resolve character-level WCL visibility + data-state via the Wave 3 async contract.
 * Prefer `discoverCharacterSummary` → ProviderResult.data.{visibility,dataState}.
 * Never treat a Promise as a sync `{ summary }` object.
 */
async function resolveWclSummary(
  provider: WorkerContainer["providers"]["warcraftlogs"],
  identity: CharacterIdentityInput,
  ctx: ProviderFetchContext,
  record: (result: Awaited<ReturnType<NonNullable<typeof provider.discoverCharacterSummary>>>) => Promise<void>,
): Promise<{
  visibility: WclVisibilityState | null;
  dataState: WclDataState | null;
  dungeonAggregates: WclDungeonPerformanceAggregateDTO[];
  performance: {
    state: string;
    raw: unknown;
    global: {
      totalMythicPlusScore: number | null;
      totalLoggedRuns: number;
      bestDpsPercentileAverage: number | null;
      medianDpsPercentileAverage: number | null;
      partition: number | null;
      zoneId: number | null;
      specRanks: unknown[];
    } | null;
    diagnostics: Record<string, unknown> | null;
  } | null;
}> {
  if (typeof provider.discoverCharacterSummary === "function") {
    const summary = await provider.discoverCharacterSummary(identity, ctx);
    await record(summary);
    const normalized = normalizeWclProvenance(
      typeof summary.data.visibility === "string" ? summary.data.visibility : null,
      typeof (summary.data as { dataState?: unknown }).dataState === "string"
        ? ((summary.data as { dataState: string }).dataState)
        : null,
    );
    const perf = (summary.data as {
      performance?: {
        state: string;
        raw: unknown;
        global: {
          totalMythicPlusScore: number | null;
          totalLoggedRuns: number;
          bestDpsPercentileAverage: number | null;
          medianDpsPercentileAverage: number | null;
          partition: number | null;
          zoneId: number | null;
          specRanks: unknown[];
        } | null;
        diagnostics: Record<string, unknown> | null;
      } | null;
    }).performance;
    return {
      visibility: normalized.visibility,
      dataState: normalized.dataState ?? parseSummaryDataState(summary.data),
      dungeonAggregates: summary.data.dungeonAggregates ?? [],
      performance: perf ?? null,
    };
  }

  // Package-local fallback (fixture/live still expose discoverCharacter).
  const maybeDiscover = provider as {
    discoverCharacter?: (
      i: CharacterIdentityInput,
      c: ProviderFetchContext,
    ) =>
      | {
          summary: { visibility: WclVisibilityState | null; dataState?: WclDataState };
          dungeonAggregates?: WclDungeonPerformanceAggregateDTO[];
          performance?: {
            state: string;
            raw: unknown;
            global: {
              totalMythicPlusScore: number | null;
              totalLoggedRuns: number;
              bestDpsPercentileAverage: number | null;
              medianDpsPercentileAverage: number | null;
              partition: number | null;
              zoneId: number | null;
              specRanks: unknown[];
            } | null;
            diagnostics: Record<string, unknown> | null;
          };
        }
      | Promise<{
          summary: { visibility: WclVisibilityState | null; dataState?: WclDataState };
          dungeonAggregates?: WclDungeonPerformanceAggregateDTO[];
          performance?: {
            state: string;
            raw: unknown;
            global: {
              totalMythicPlusScore: number | null;
              totalLoggedRuns: number;
              bestDpsPercentileAverage: number | null;
              medianDpsPercentileAverage: number | null;
              partition: number | null;
              zoneId: number | null;
              specRanks: unknown[];
            } | null;
            diagnostics: Record<string, unknown> | null;
          };
        }>;
  };
  if (typeof maybeDiscover.discoverCharacter === "function") {
    const discovery = await Promise.resolve(maybeDiscover.discoverCharacter(identity, ctx));
    const normalized = normalizeWclProvenance(
      discovery?.summary?.visibility,
      discovery?.summary?.dataState,
    );
    return {
      visibility: normalized.visibility,
      dataState: normalized.dataState,
      dungeonAggregates: discovery?.dungeonAggregates ?? [],
      performance: discovery?.performance ?? null,
    };
  }

  return { visibility: null, dataState: null, dungeonAggregates: [], performance: null };
}

function parseSummaryDataState(summary: { dataState?: unknown; visibility?: unknown }): WclDataState | null {
  return normalizeWclProvenance(
    typeof summary.visibility === "string" ? summary.visibility : null,
    typeof summary.dataState === "string" ? summary.dataState : null,
  ).dataState;
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
  const identityFingerprint = fingerprintIdentifier(
    `${identity.region}:${identity.realmSlug}:${identity.name}`.toLocaleLowerCase("en-US"),
  );
  const logBase = {
    correlationId: ctx.correlationId ?? ctx.requestId,
    identityFingerprint,
    region: identity.region,
  };

  logger.info({ ...logBase, event: OBS_EVENTS.refreshWorkerStarted }, OBS_EVENTS.refreshWorkerStarted);

  const dedupeKey = refreshCharacterDedupeKey(jobPayload);
  const { job: createdJob, reused } = await repositories.job.createOrGetByDedupe({
    jobType: "refresh-character",
    dedupeKey,
    payload: jobPayload,
  });
  logger.info(
    { ...logBase, event: OBS_EVENTS.refreshDedupe, dedupeKey, reused, jobId: createdJob.id },
    OBS_EVENTS.refreshDedupe,
  );
  let job = await repositories.job.markActive(createdJob.id);
  let terminalized = false;

  const ensureFailed = async (error: unknown): Promise<void> => {
    if (terminalized) return;
    const current = await repositories.job.findById(job.id);
    if (current && (current.status === "QUEUED" || current.status === "ACTIVE")) {
      job = await repositories.job.markFailed(job.id, error);
    }
    terminalized = true;
  };

  try {
  if (negativeCache.has(identity) && !jobPayload.forceRefresh) {
    job = await repositories.job.markFailed(job.id, new Error("negative cache hit: identity not found"));
    terminalized = true;
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
    await ensureFailed(error);
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
  let wclDataState: WclDataState | null = null;
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
      logger.info(
        { ...logBase, event: OBS_EVENTS.refreshProviderPhaseStarted, provider: "blizzard" },
        OBS_EVENTS.refreshProviderPhaseStarted,
      );
      const profile = await providers.blizzard.getCharacterProfile(identity, ctx);
      blizzardProfile = profile.data;
      character = await repositories.character.applyProviderProfile(character.id, profile.data);
      await recordProviderResult(repositories, profile);

      const equipment = await providers.blizzard.getCharacterEquipment(identity, ctx);
      blizzardItemLevel = equipment.data.itemLevelEquipped;
      const equipmentSnapshot = await providers.blizzard.getEquipmentSnapshot(identity, ctx);

      let mediaExtras: {
        avatarUrl: string | null;
        insetUrl: string | null;
        mainRawUrl: string | null;
      } | null = null;
      try {
        const media = await providers.blizzard.getCharacterMedia(identity, ctx);
        await recordProviderResult(repositories, media);
        mediaExtras = {
          avatarUrl: media.data.avatarUrl,
          insetUrl: media.data.insetUrl,
          mainRawUrl: media.data.mainUrl,
        };
      } catch (mediaError) {
        logger.info({ identity, err: mediaError }, "refresh pipeline: character media soft-skip");
      }

      let talentExtras: {
        specializationSlug: string | null;
        loadoutCode: string | null;
        talents: unknown;
      } | null = null;
      try {
        const talents = await providers.blizzard.getTalentSnapshot(identity, ctx);
        await recordProviderResult(repositories, talents);
        talentExtras = {
          specializationSlug: talents.data.specializationSlug,
          loadoutCode: talents.data.loadoutCode,
          talents: talents.data.talents,
        };
      } catch (talentError) {
        logger.info({ identity, err: talentError }, "refresh pipeline: talent snapshot soft-skip");
      }

      await repositories.character.recordSnapshot(
        character.id,
        equipment.data,
        {
          averageItemLevel: equipmentSnapshot.data.averageItemLevel,
          equippedItemLevel: equipmentSnapshot.data.equippedItemLevel,
          items: equipmentSnapshot.data.items,
          keyItems: equipmentSnapshot.data.keyItems,
        },
        { media: mediaExtras, talent: talentExtras },
      );
      await recordProviderResult(repositories, equipment);
      await recordProviderResult(repositories, equipmentSnapshot);

      // Prefer specialization/role from the equipment+talents bundle when profile omitted them.
      if (
        (!blizzardProfile.specSlug || !blizzardProfile.role) &&
        (equipment.data.activeSpecSlug || equipment.data.role)
      ) {
        character = await repositories.character.applyProviderProfile(character.id, {
          ...blizzardProfile,
          specSlug: blizzardProfile.specSlug ?? equipment.data.activeSpecSlug,
          role: blizzardProfile.role ?? equipment.data.role,
        });
        blizzardProfile = {
          ...blizzardProfile,
          specSlug: blizzardProfile.specSlug ?? equipment.data.activeSpecSlug,
          role: blizzardProfile.role ?? equipment.data.role,
        };
      }

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
      logger.info(
        {
          ...logBase,
          event: OBS_EVENTS.refreshProviderPhaseCompleted,
          provider: "blizzard",
          resultState: "OK",
          recordsDiscovered: blizzardRuns.length,
        },
        OBS_EVENTS.refreshProviderPhaseCompleted,
      );
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
    dataState: WclDataState | null;
    runs: MythicRunDTO[];
    dungeonAggregates: WclDungeonPerformanceAggregateDTO[];
    rankings: WclRankingObservation[];
    performance: Awaited<ReturnType<typeof resolveWclSummary>>["performance"];
    rejectedLegacyCache: boolean;
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
      logger.info(
        { ...logBase, event: OBS_EVENTS.refreshProviderPhaseStarted, provider: "raiderio" },
        OBS_EVENTS.refreshProviderPhaseStarted,
      );
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

  const enrichWarcraftLogs = async (
    hydrationHints: NonNullable<ProviderFetchContext["wclHydrationHints"]>,
  ): Promise<WclEnrichment> => {
    if (disabledProviders.has("warcraftlogs") || isFixtureDisabledIdentity(identity)) {
      stagesSkipped.push("refresh-warcraftlogs-summary");
      await repositories.providerState.upsert({
        characterId: character.id,
        provider: "warcraftlogs",
        state: "UNAVAILABLE",
        detail: "provider disabled",
        lastAttemptAt: now,
      });
      return { visibility: null, dataState: null, runs: [], dungeonAggregates: [], rankings: [], performance: null, rejectedLegacyCache: false };
    }

    const wclCtx: ProviderFetchContext = {
      ...ctx,
      wclHydrationHints: hydrationHints,
    };

    let visibility: WclVisibilityState | null = null;
    let dataState: WclDataState | null = null;
    let dungeonAggregates: WclDungeonPerformanceAggregateDTO[] = [];
    let performance: WclEnrichment["performance"] = null;
    let rejectedLegacyCache = false;
    try {
      logger.info(
        { ...logBase, event: OBS_EVENTS.refreshProviderPhaseStarted, provider: "warcraftlogs" },
        OBS_EVENTS.refreshProviderPhaseStarted,
      );

      const zoneId = resolveMplusZoneConfig({
        env: process.env,
        allowFixtureDefault: container.env.APP_ENV === "test" || container.env.NODE_ENV === "test",
      }).zoneId;
      const summaryFingerprint = buildWclSummaryRequestFingerprint({
        region: identity.region,
        realmSlug: identity.realmSlug,
        name: identity.name,
        zoneId,
        partition: null,
      });

      // Always inspect the fingerprint cache — even on forceRefresh — so legacy payloads are
      // explicitly rejected and never treated as a successful points_and_damage dataset.
      const cached = await repositories.externalRequest.findFreshPayloadByFingerprint({
        requestFingerprint: summaryFingerprint,
        now,
      });
      if (cached?.payload?.payload != null) {
        if (!isCompatiblePointsAndDamageSummary(cached.payload.payload)) {
          rejectedLegacyCache = true;
          fusionWarnings.push("WCL_LEGACY_SUMMARY_CACHE_REJECTED");
          logger.warn(
            {
              identity,
              requestFingerprint: summaryFingerprint,
              schemaVersion: cached.payload.schemaVersion,
              forceRefresh: jobPayload.forceRefresh,
            },
            "refresh pipeline: rejected incompatible legacy WCL summary cache — forcing live points_and_damage fetch",
          );
        }
      }

      const summary = await resolveWclSummary(
        providers.warcraftlogs,
        identity,
        { ...wclCtx, forceRefresh: jobPayload.forceRefresh || rejectedLegacyCache },
        async (result) => {
          // Never persist an incompatible legacy-shaped summary as a successful cache entry.
          if (
            result.metadata.endpointKey === "discoverCharacterSummary" &&
            !isCompatiblePointsAndDamageSummary(result.data) &&
            (result.data as { performance?: { state?: string } })?.performance?.state !== "SKIPPED"
          ) {
            fusionWarnings.push("WCL_POINTS_AND_DAMAGE_SUMMARY_INCOMPATIBLE");
            await recordProviderResult(repositories, {
              ...result,
              metadata: {
                ...result.metadata,
                cacheHit: false,
                statusCode: result.metadata.statusCode ?? 200,
              },
              provenance: {
                ...result.provenance,
                schemaVersion: `${POINTS_AND_DAMAGE_ADAPTER_VERSION}:rejected`,
              },
            });
            return;
          }
          await recordProviderResult(repositories, {
            ...result,
            metadata: {
              ...result.metadata,
              cacheHit: false,
            },
          });
        },
      );
      visibility = summary.visibility;
      dataState = summary.dataState;
      dungeonAggregates = summary.dungeonAggregates;
      performance = summary.performance;

      const performanceOkForSuccess =
        performance?.state === "OK" || performance?.state === "SKIPPED";

      const runsResult = await providers.warcraftlogs.discoverCharacterRuns(identity, wclCtx);
      await recordProviderResult(repositories, runsResult);
      const wclRankings =
        (runsResult as { wclRankings?: WclRankingObservation[] }).wclRankings ?? [];

      // Do not mark WCL refresh successful when Performance came back incompatible/error.
      const markSuccess = performanceOkForSuccess || performance == null;
      await repositories.providerState.upsert({
        characterId: character.id,
        provider: "warcraftlogs",
        state: markSuccess
          ? mapWclVisibilityToState(visibility, dataState)
          : "UNAVAILABLE",
        detail: markSuccess
          ? undefined
          : `points_and_damage Performance unavailable (${performance?.state ?? "missing"})`,
        wclVisibility: visibility,
        lastAttemptAt: now,
        ...(markSuccess ? { lastSuccessAt: now } : {}),
        fetchedAt: now,
        expiresAt: runsResult.freshness.expiresAt ? new Date(runsResult.freshness.expiresAt) : null,
        metadata: {
          wclDataState: dataState,
          discoveredRunCount: runsResult.data.length,
          hydrationHintCount: hydrationHints.length,
          dungeonAggregateCount: dungeonAggregates.length,
          performanceState: performance?.state ?? null,
          performanceAdapterVersion: POINTS_AND_DAMAGE_ADAPTER_VERSION,
          rejectedLegacyCache,
          summaryFingerprint,
        },
      });
      return {
        visibility,
        dataState,
        runs: runsResult.data,
        dungeonAggregates,
        rankings: wclRankings,
        performance,
        rejectedLegacyCache,
      };
    } catch (error) {
      // WCL is enrichment-only: never block a Blizzard/Raider.IO-backed MVP score.
      // GraphQL schema / invalid-response errors stay UNAVAILABLE with detail.
      // Performance may already be OK from summary even if combat/report hydration fails later.
      stagesSkipped.push("refresh-warcraftlogs-summary");
      const state = mapErrorToProviderState(error);
      const failedDataState: WclDataState =
        state === "RATE_LIMITED" ? "RATE_LIMITED" : dataState ?? "UNAVAILABLE";
      await repositories.providerState.upsert({
        characterId: character.id,
        provider: "warcraftlogs",
        state:
          state === "PRIVATE_OR_HIDDEN"
            ? "PRIVATE_OR_HIDDEN"
            : visibility
              ? mapWclVisibilityToState(visibility, failedDataState)
              : state,
        detail: error instanceof Error ? error.message : "enrichment soft-skip",
        wclVisibility: visibility,
        lastAttemptAt: now,
        metadata: {
          wclDataState: failedDataState,
          performanceState: performance?.state ?? null,
          performanceAdapterVersion: POINTS_AND_DAMAGE_ADAPTER_VERSION,
          rejectedLegacyCache,
        },
      });
      logger.info({ identity, err: error }, "refresh pipeline: WCL soft-skipped");
      return {
        visibility,
        dataState: failedDataState,
        runs: [],
        dungeonAggregates,
        rankings: [],
        performance,
        rejectedLegacyCache,
      };
    }
  };

  // Raider.IO first so current-season run hints can prioritize WCL report hydration.
  const rioEnrichment = await enrichRaiderIo();
  raiderIoProfile = rioEnrichment.profile;
  seasonCutoffs = rioEnrichment.cutoffs;
  boostFacts = rioEnrichment.boost;

  const rioRunsRaw =
    raiderIoProfile != null
      ? collectRaiderIoRuns(raiderIoProfile.recentRuns, raiderIoProfile.bestRuns, identity)
      : [];
  const nowMs = now.getTime();
  blizzardRuns = filterRunsToActiveWindow(blizzardRuns, { nowMs });
  const rioRuns = filterRunsToActiveWindow(rioRunsRaw, { nowMs });
  const hydrationHints = [...blizzardRuns, ...rioRuns].map((run) => ({
    completedAt: run.completedAt,
    dungeonSlug: run.dungeonSlug,
    keyLevel: run.keyLevel,
  }));

  const wclEnrichment = await enrichWarcraftLogs(hydrationHints);
  wclVisibility = wclEnrichment.visibility;
  wclDataState = wclEnrichment.dataState;
  discoveredRuns = wclEnrichment.runs;
  const wclDungeonAggregates = wclEnrichment.dungeonAggregates;
  const wclRankings = wclEnrichment.rankings;
  const wclPerformanceRecord = wclEnrichment.performance;
  const wclRejectedLegacyCache = wclEnrichment.rejectedLegacyCache;

  // ── Reconcile + fuse runs ───────────────────────────────────────────────
  const reconcile = reconcileSources({
    blizzard: blizzardProfile,
    blizzardItemLevel,
    raiderIo: raiderIoProfile,
    blizzardMythicRating: mythicKeystoneScore,
  });
  disagreements.push(...reconcile.disagreements);
  fusionWarnings.push(...reconcile.warnings);

  // Resolve Blizzard current season before persistence so runs/scores share one identity.
  const season =
    currentSeasonId != null
      ? await ensureBlizzardCurrentSeason(container.prisma, character.regionId, currentSeasonId)
      : await ensureCurrentSeason(container.prisma, character.regionId);

  // Raider.IO fallback for missing Blizzard class/spec/role/gear/talents.
  if (raiderIoProfile) {
    const needsIdentityFallback =
      !blizzardProfile?.classSlug ||
      !blizzardProfile?.specSlug ||
      !blizzardProfile?.role ||
      !character.classId ||
      !character.activeSpecId ||
      !character.role;
    if (needsIdentityFallback) {
      character = await repositories.character.applyProviderProfile(character.id, {
        id: character.id,
        region: identity.region,
        realmSlug: identity.realmSlug,
        normalizedName: character.normalizedName,
        displayName: character.displayName,
        classSlug: blizzardProfile?.classSlug ?? raiderIoProfile.classSlug,
        specSlug: blizzardProfile?.specSlug ?? raiderIoProfile.specSlug,
        role: blizzardProfile?.role ?? raiderIoProfile.role,
        blizzardCharacterId: blizzardProfile?.blizzardCharacterId ?? null,
        wclCanonicalId: null,
        raiderioProfileUrl: raiderIoProfile.profileUrl,
        lastSeenAt: null,
        lastPublicRefreshAt: null,
      });
    }

    if (blizzardItemLevel == null && raiderIoProfile.gear) {
      const rioIlvl = raiderIoProfile.gear.itemLevelEquipped;
      // Preserve null — never fabricate zero item level.
      if (rioIlvl != null) {
        await repositories.character.recordSnapshot(
          character.id,
          {
            id: randomUUID(),
            characterId: character.id,
            capturedAt: now.toISOString(),
            itemLevelEquipped: rioIlvl,
            activeSpecSlug: raiderIoProfile.specSlug,
            role: raiderIoProfile.role,
            mythicRating: mythicKeystoneScore,
            sourcePayloadId: null,
          },
          {
            averageItemLevel: raiderIoProfile.gear.itemLevelTotal ?? rioIlvl,
            equippedItemLevel: rioIlvl,
            items: raiderIoProfile.gear.items ?? [],
            keyItems: [],
          },
        );
      }
    }
  }

  const fusion = fuseCrossProviderRuns([...blizzardRuns, ...rioRuns, ...discoveredRuns]);
  const fusedRuns = fusion.runs.map((run) =>
    ensureTargetParticipant(
      {
        ...run,
        // Current-season refresh always persists under the resolved Blizzard season identity.
        seasonSlug: season.slug,
      },
      identity,
    ),
  );
  const sharedSourceRunCount = fusedRuns.filter(
    (run) => new Set(run.sources.map((s) => s.provider)).size > 1,
  ).length;
  const sourcelessRows = fusedRuns.filter((run) => run.sources.length === 0).length;
  logger.info(
    {
      ...logBase,
      event: OBS_EVENTS.refreshFusionCompleted,
      providerSourceCounts: {
        blizzard: blizzardRuns.length,
        raiderio: rioRuns.length,
        warcraftlogs: discoveredRuns.length,
      },
      canonicalRunCount: fusion.mergedCanonicalRunCount,
      sharedSourceRunCount,
      duplicatesReconciled: fusion.matchedPairCount,
      unresolvedCandidateMatches: fusion.unresolvedCrossProviderMatches,
      sourcelessRows,
    },
    OBS_EVENTS.refreshFusionCompleted,
  );

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
      seasonId: season.id,
    });
  }

  const reconcileResult = await repositories.run.reconcileDuplicateRunsForCharacter(
    character.id,
    season.id,
  );
  if (reconcileResult.deletedRunCount > 0) {
    logger.info(
      {
        identity,
        mergedGroups: reconcileResult.mergedGroups,
        deletedRunCount: reconcileResult.deletedRunCount,
      },
      "refresh pipeline: reconciled duplicate MythicRun rows",
    );
  }

  // Re-count after reconcile so volume_recency / seasonSummary use canonical rows.
  const canonicalRunCount = await repositories.run.countForCharacter(character.id, season.id);
  const volumeRunCount = canonicalRunCount > 0 ? canonicalRunCount : fusion.mergedCanonicalRunCount;

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

  // ── Select + analyze detailed runs (eight-run scoring set) ───────────────
  const persistedRunsSeason = await repositories.run.findRunsForCharacterInSeason(
    character.id,
    season.id,
  );
  const persistedRuns =
    persistedRunsSeason.length > 0
      ? persistedRunsSeason
      : await repositories.run.findAllTargetRunsForCharacter(character.id);
  const persistedByFingerprint = new Map(
    persistedRuns.map((run) => [run.canonicalFingerprint, run]),
  );
  const candidateFromPersisted = persistedRuns.map((run) => ({
    canonicalRunId: run.id,
    dungeonSlug: canonicalDungeonKey(run.dungeon.slug),
    keyLevel: run.keyLevel,
    timed: run.timed,
    completedAt: run.completedAt.toISOString(),
    durationMs: run.durationMs,
    scoreValue: run.scoreValue,
    hasWclSource: run.sources.some((s) => s.provider === "WARCRAFT_LOGS"),
  }));
  const candidateFromFusion = fusedRuns
    .filter((run) => persistedByFingerprint.has(run.canonicalFingerprint))
    .map((run) => {
      const persisted = persistedByFingerprint.get(run.canonicalFingerprint)!;
      return {
        canonicalRunId: persisted.id,
        dungeonSlug: canonicalDungeonKey(persisted.dungeon.slug),
        keyLevel: persisted.keyLevel,
        timed: persisted.timed,
        completedAt: persisted.completedAt.toISOString(),
        durationMs: persisted.durationMs,
        scoreValue: persisted.scoreValue,
        hasWclSource: persisted.sources.some((s) => s.provider === "WARCRAFT_LOGS"),
      };
    });
  const scoringCandidates =
    candidateFromPersisted.length > 0 ? candidateFromPersisted : candidateFromFusion;
  const expectedDungeonCount = season.dungeonCount > 0 ? season.dungeonCount : 8;
  const seasonDungeonRows = await container.prisma.seasonDungeon.findMany({
    where: { seasonId: season.id },
    include: { dungeon: true },
    orderBy: { sortOrder: "asc" },
  });
  const blizzardSeasonDungeonSlugs = readBlizzardSeasonDungeonSlugsFromMetadata(season.metadata);
  const activeSeasonDungeonPool = resolveActiveSeasonDungeonPool({
    expectedDungeonCount,
    seasonDungeonSlugs: seasonDungeonRows.map((row) => canonicalDungeonKey(row.dungeon.slug)),
    blizzardSeasonDungeonSlugs,
    // Never leave the pool empty — empty allowlists reintroduce Icecrown/legacy 9-run selections.
    raiderioDungeonSlugs: CURRENT_MPLUS_ZONE_DUNGEON_SLUGS,
    wclDungeonSlugs: wclDungeonAggregates.map((d) => d.dungeonSlug),
  });
  const activeDungeonSlugs = activeSeasonDungeonPool.canonicalSlugs;
  const selectionFilter =
    activeDungeonSlugs.length > 0
      ? { allowedDungeonSlugs: activeDungeonSlugs }
      : { allowedDungeonSlugs: CURRENT_MPLUS_ZONE_DUNGEON_SLUGS };
  let scoringRunSelection = selectScoringRuns(scoringCandidates, {
    seasonSlug: season.slug,
    expectedDungeonCount,
    ...selectionFilter,
  });
  if (scoringRunSelection.selectedRuns.length !== expectedDungeonCount) {
    logger.warn(
      {
        identity,
        expectedDungeonCount,
        selectedRunCount: scoringRunSelection.selectedRuns.length,
        activeDungeonSlugs,
        activeSeasonPoolSource: activeSeasonDungeonPool.source,
        wclOffPoolSlugs: activeSeasonDungeonPool.wclOffPoolSlugs,
        candidateDungeonCount: new Set(scoringCandidates.map((c) => c.dungeonSlug)).size,
      },
      "refresh pipeline: scoring run selection count mismatch after active-season filter",
    );
  }

  const survivalRunSelection = selectSurvivalAnalysisRuns(scoringCandidates, {
    allowedDungeonSlugs: selectionFilter.allowedDungeonSlugs,
    maxRunsPerDungeon: SURVIVAL_STANDALONE_V1_1_1_CONFIG.selection.maxRunsPerDungeon,
  });

  const selectedRunRows = new Map<
    string,
    (typeof persistedRuns)[number]
  >();
  for (const entry of scoringRunSelection.selectedRuns) {
    const row = persistedRuns.find((r) => r.id === entry.canonicalRunId);
    if (row) selectedRunRows.set(row.id, row);
  }
  for (const entry of survivalRunSelection.selectedRuns) {
    const row = persistedRuns.find((r) => r.id === entry.canonicalRunId);
    if (row) selectedRunRows.set(row.id, row);
  }

  if (selectedRunRows.size === 0) {
    const [latestRun, highestRun] = await Promise.all([
      repositories.run.findLatestForCharacter(character.id),
      repositories.run.findHighestForCharacter(character.id),
    ]);
    if (latestRun) selectedRunRows.set(latestRun.id, latestRun);
    if (highestRun) selectedRunRows.set(highestRun.id, highestRun);
    if (scoringRunSelection.selectedRuns.length === 0 && selectedRunRows.size > 0) {
      scoringRunSelection = selectScoringRuns(
        [...selectedRunRows.values()].map((run) => ({
          canonicalRunId: run.id,
          dungeonSlug: canonicalDungeonKey(run.dungeon.slug),
          keyLevel: run.keyLevel,
          timed: run.timed,
          completedAt: run.completedAt.toISOString(),
          durationMs: run.durationMs,
          scoreValue: run.scoreValue,
          hasWclSource: run.sources.some((s) => s.provider === "WARCRAFT_LOGS"),
        })),
        {
          seasonSlug: season.slug,
          expectedDungeonCount,
          ...selectionFilter,
        },
      );
    }
  }

  const combatFactsList: RunCombatFacts[] = [];
  const combatFactsByRunId = new Map<string, RunCombatFacts>();
  const fightMetaByRunId = new Map<
    string,
    { startTime: number; endTime: number; encounterId: number | null; encounterName: string | null }
  >();
  const runCoverageById: Record<string, number> = {};
  const runDiagnostics: Array<Record<string, unknown>> = [];
  const earlyClassSlug = blizzardProfile?.classSlug ?? raiderIoProfile?.classSlug ?? null;
  const earlySpecSlug = blizzardProfile?.specSlug ?? raiderIoProfile?.specSlug ?? null;
  let analysisAttemptedCount = 0;

  if (!disabledProviders.has("warcraftlogs")) {
    let runsToAnalyze = [...selectedRunRows.values()];
    if (runsToAnalyze.length === 0) {
      const [latestRun, highestRun] = await Promise.all([
        repositories.run.findLatestForCharacter(character.id),
        repositories.run.findHighestForCharacter(character.id),
      ]);
      runsToAnalyze = [latestRun, highestRun].filter((run): run is NonNullable<typeof run> => run != null);
    }
    if (runsToAnalyze.length === 0) {
      stagesSkipped.push("analyze-run");
    }
    for (const run of runsToAnalyze) {
      analysisAttemptedCount += 1;
      const source = await repositories.run.findWclSource(run.id);
      const parseBinding = bindParseToSelectedRun({
        runId: run.id,
        dungeonSlug: run.dungeon.slug,
        reportCode: source?.reportCode ?? null,
        fightId: source?.fightId ?? null,
        rankings: wclRankings,
      });

      if (!source) {
        runDiagnostics.push({
          runId: run.id,
          dungeonSlug: run.dungeon.slug,
          keyLevel: run.keyLevel,
          wclReportMatched: false,
          parse: parseBinding,
          detailedAnalysis: false,
          reason: "no_wcl_source_on_selected_run",
        });
        continue;
      }

      try {
        const detailsResult = await providers.warcraftlogs.getReportFightDetails(
          source.reportCode,
          source.fightId,
          ctx,
        );
        const details = detailsResult.data as WclReportFightDetails;
        const payloadId = await recordProviderResult(repositories, detailsResult);
        combatFactsList.push(details.combatFacts);
        combatFactsByRunId.set(run.id, details.combatFacts);
        fightMetaByRunId.set(run.id, {
          startTime: details.fight.startTime,
          endTime: details.fight.endTime,
          encounterId: details.fight.encounterId,
          encounterName: details.fight.name,
        });

        const coverageRatio =
          Object.values(details.combatFacts.coverage).filter(Boolean).length /
          Object.keys(details.combatFacts.coverage).length;
        const usableCombat = isUsableCombatRun(details.combatFacts);
        if (usableCombat) {
          runCoverageById[run.id] = coverageRatio;
        }

        const combatAdmin = buildRunCombatAdminDiagnostics(details.combatFacts, {
          dungeonSlug: run.dungeon.slug,
          runDurationMs: run.durationMs,
          classSlug: earlyClassSlug,
          specSlug: earlySpecSlug,
        });

        await repositories.run.upsertRunAnalysis({
          runId: run.id,
          characterId: character.id,
          analysisVersion: "wcl-combat-facts-v1",
          analyzedAt: now,
          coverage: usableCombat ? coverageRatio : 0,
          summary: {
            wclVisibility,
            combatFacts: toPersistedCombatFacts(details.combatFacts),
            deathCount: details.combatFacts.deaths.length,
            interruptCount: details.combatFacts.interrupts.length,
            parseBinding,
            fightStartTime: details.fight.startTime,
            fightEndTime: details.fight.endTime,
            encounterId: details.fight.encounterId,
            encounterName: details.fight.name,
            ...combatAdmin,
          },
          sourcePayloadIds: payloadId ? [payloadId] : [],
        });

        runDiagnostics.push({
          runId: run.id,
          dungeonSlug: run.dungeon.slug,
          keyLevel: run.keyLevel,
          reportCode: source.reportCode,
          fightId: source.fightId,
          wclReportMatched: true,
          parse: parseBinding,
          detailedAnalysis: usableCombat,
          coverageRatio: usableCombat ? coverageRatio : null,
          attributedSourceIds: details.combatFacts.attributedSourceIds,
          ...combatAdmin,
        });
      } catch (error) {
        if (isEnrichmentSoftSkip(error)) {
          logger.info({ identity, err: error, runId: run.id }, "refresh pipeline: analyze-run soft-skipped");
          runDiagnostics.push({
            runId: run.id,
            dungeonSlug: run.dungeon.slug,
            detailedAnalysis: false,
            reason: error instanceof Error ? error.message : "analyze_soft_skip",
            parse: parseBinding,
          });
          continue;
        }
        await failHard("analyze-run", error);
      }
    }
  } else {
    stagesSkipped.push("analyze-run");
  }

  // ── Survival V1.1.1 run analyses (reuse compatible cache; fetch missing only) ──
  const survivalCost = createSurvivalRequestCost();
  const survivalRows: SurvivalRunAnalysisRow[] = [];
  let survivalRequiredFailed = false;
  let survivalLateBoundRunCount = 0;
  const survivalBindPool = buildSurvivalWclBindPool(discoveredRuns, wclRankings);
  const survivalCatalog = getAbilityCatalog({
    classSlug: earlyClassSlug,
    specSlug: earlySpecSlug,
    role:
      (blizzardProfile?.role ?? raiderIoProfile?.role) === "TANK"
        ? "TANK"
        : (blizzardProfile?.role ?? raiderIoProfile?.role) === "HEALER"
          ? "HEALER"
          : "DPS",
    includeShared: true,
    includeRacials: false,
  });

  if (!disabledProviders.has("warcraftlogs") && scoringCandidates.length > 0) {
    const maxSurvivalPerDungeon =
      SURVIVAL_STANDALONE_V1_1_1_CONFIG.selection.maxRunsPerDungeon;
    const allowedSurvivalDungeons = new Set(
      (selectionFilter.allowedDungeonSlugs ?? []).map((s) => s.trim().toLowerCase()),
    );
    const survivalCandidatesByDungeon = new Map<string, typeof scoringCandidates>();
    for (const candidate of scoringCandidates) {
      const slug = canonicalDungeonKey(candidate.dungeonSlug);
      if (allowedSurvivalDungeons.size > 0 && !allowedSurvivalDungeons.has(slug)) continue;
      const bucket = survivalCandidatesByDungeon.get(slug) ?? [];
      bucket.push(candidate);
      survivalCandidatesByDungeon.set(slug, bucket);
    }

    const compareSurvivalCandidates = (
      a: (typeof scoringCandidates)[number],
      b: (typeof scoringCandidates)[number],
    ): number => {
      if (a.keyLevel !== b.keyLevel) return b.keyLevel - a.keyLevel;
      const scoreA = a.scoreValue ?? -1;
      const scoreB = b.scoreValue ?? -1;
      if (scoreA !== scoreB) return scoreB - scoreA;
      return new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime();
    };

    const usedSurvivalRunIds = new Set<string>();
    const usedReportFightKeys = new Set<string>();
    const liveWcl = providers.warcraftlogs as {
      analyzeSurvivalCanonicalRun?: (
        input: Record<string, unknown>,
        ctx: ProviderFetchContext,
      ) => Promise<{
        data: {
          summary: SurvivalRunAnalysisRow["summary"];
          requestCount: number;
          maxHpFailureReason: string | null;
        };
      }>;
    };

    for (const dungeonSlug of [...survivalCandidatesByDungeon.keys()].sort((a, b) =>
      a.localeCompare(b),
    )) {
      const bucket = [...(survivalCandidatesByDungeon.get(dungeonSlug) ?? [])].sort(
        compareSurvivalCandidates,
      );
      let acceptedForDungeon = 0;

      for (const candidate of bucket) {
        if (acceptedForDungeon >= maxSurvivalPerDungeon) break;
        if (usedSurvivalRunIds.has(candidate.canonicalRunId)) continue;

        const run = persistedRuns.find((r) => r.id === candidate.canonicalRunId);
        if (!run) {
          survivalCost.rejectedCandidates.push({
            reason: "run_row_missing",
            runId: candidate.canonicalRunId,
            dungeonSlug,
          });
          continue;
        }

        let source = await repositories.run.findWclSource(run.id);
        let lateBound = false;
        if (!source) {
          const bind = matchSurvivalWclSource(
            {
              dungeonSlug: canonicalDungeonKey(run.dungeon.slug),
              keyLevel: run.keyLevel,
              completedAt: run.completedAt.toISOString(),
              durationMs: run.durationMs,
            },
            survivalBindPool,
            { excludeReportFightKeys: usedReportFightKeys },
          );
          if (!bind.matched) {
            survivalCost.rejectedCandidates.push({
              reason: bind.reason,
              runId: run.id,
              dungeonSlug,
            });
            continue;
          }
          source = await repositories.run.attachWclSource(run.id, {
            reportCode: bind.reportCode,
            fightId: bind.fightId,
          });
          lateBound = true;
          survivalLateBoundRunCount += 1;
        }

        const reportFightKey = `${source.reportCode}:${source.fightId}`;
        if (usedReportFightKeys.has(reportFightKey)) {
          survivalCost.rejectedCandidates.push({
            reason: "wcl_report_fight_already_used",
            runId: run.id,
            dungeonSlug,
          });
          continue;
        }

        let facts = combatFactsByRunId.get(run.id) ?? null;
        if (!facts) {
          try {
            const detailsResult = await providers.warcraftlogs.getReportFightDetails(
              source.reportCode,
              source.fightId,
              ctx,
            );
            survivalCost.wclHttpRequestCount += 1;
            survivalCost.graphqlOperationCount += 1;
            await recordProviderResult(repositories, detailsResult);
            facts = (detailsResult.data as WclReportFightDetails).combatFacts;
            combatFactsByRunId.set(run.id, facts);
            combatFactsList.push(facts);
            const details = detailsResult.data as WclReportFightDetails;
            fightMetaByRunId.set(run.id, {
              startTime: details.fight.startTime,
              endTime: details.fight.endTime,
              encounterId: details.fight.encounterId,
              encounterName: details.fight.name,
            });
          } catch (error) {
            if (isEnrichmentSoftSkip(error)) {
              survivalCost.rejectedCandidates.push({
                reason: "fight_details_soft_skip",
                runId: run.id,
                dungeonSlug,
              });
              continue;
            }
            survivalRequiredFailed = true;
            await failHard("analyze-run", error);
          }
        }
        if (!facts) continue;

        const expectedKey = expectedSurvivalCompatibilityKey({
          characterId: character.id,
          reportCode: source.reportCode,
          fightId: source.fightId,
          reportRevision: facts.revision,
          abilityCatalogVersion: survivalCatalog.catalogVersion,
        });

        const cached = await repositories.run.findRunAnalysis(
          run.id,
          character.id,
          SURVIVAL_STANDALONE_V1_1_1_CONFIG.analysisVersion,
        );
        if (
          !jobPayload.forceRefresh &&
          cached &&
          isCompatibleSurvivalSummary(cached.summary, expectedKey)
        ) {
          survivalCost.reusedRunAnalyses += 1;
          survivalRows.push({
            runId: run.id,
            dungeonSlug: canonicalDungeonKey(run.dungeon.slug),
            dungeonName: run.dungeon.name,
            keyLevel: run.keyLevel,
            summary: cached.summary,
            fromCache: true,
          });
          usedSurvivalRunIds.add(run.id);
          usedReportFightKeys.add(reportFightKey);
          acceptedForDungeon += 1;
          if (lateBound) {
            const selected = survivalRunSelection.selectedRuns.find(
              (e) => e.canonicalRunId === run.id,
            );
            if (selected) selected.wclReportMatched = true;
          }
          continue;
        }

        if (typeof liveWcl.analyzeSurvivalCanonicalRun !== "function") {
          survivalCost.rejectedCandidates.push({
            reason: "survival_canonical_analyze_unsupported",
            runId: run.id,
            dungeonSlug,
          });
          survivalRequiredFailed = true;
          continue;
        }

        try {
          const meta = fightMetaByRunId.get(run.id);
          const fightStart = meta?.startTime ?? 0;
          const fightEnd = meta?.endTime ?? fightStart + run.durationMs;
          const canonicalResult = await liveWcl.analyzeSurvivalCanonicalRun(
            {
              identity,
              characterId: character.id,
              reportCode: source.reportCode,
              fightId: source.fightId,
              reportRevision: facts.revision,
              dungeonSlug: canonicalDungeonKey(run.dungeon.slug),
              keyLevel: run.keyLevel,
              playerActorId: facts.targetSourceId,
              ownedPetActorIds: facts.attributedSourceIds.filter(
                (id) => id !== facts.targetSourceId,
              ),
              fightStartTime: fightStart,
              fightEndTime: fightEnd,
              encounterId: meta?.encounterId ?? null,
              encounterName: meta?.encounterName ?? null,
              catalog: survivalCatalog,
              classSlug: earlyClassSlug,
              specSlug: earlySpecSlug,
              timed: run.timed,
              completed: true,
              score: run.scoreValue,
            },
            ctx,
          );
          survivalCost.wclHttpRequestCount += canonicalResult.data.requestCount;
          survivalCost.graphqlOperationCount += canonicalResult.data.requestCount;
          const payloadId = await recordProviderResult(repositories, canonicalResult as never);
          const summary = canonicalResult.data.summary;
          if (
            summary.maxHpResolution.baselineMaxHp == null &&
            canonicalResult.data.maxHpFailureReason
          ) {
            summary.maxHpResolution = {
              ...summary.maxHpResolution,
              resolutionFailureReason:
                summary.maxHpResolution.resolutionFailureReason ??
                canonicalResult.data.maxHpFailureReason,
            };
          }
          await repositories.run.upsertRunAnalysis({
            runId: run.id,
            characterId: character.id,
            analysisVersion: SURVIVAL_STANDALONE_V1_1_1_CONFIG.analysisVersion,
            analyzedAt: now,
            coverage: summary.maxHpResolution.baselineMaxHp != null ? 1 : 0.35,
            summary,
            sourcePayloadIds: payloadId ? [payloadId] : [],
          });
          survivalCost.newRunAnalyses += 1;
          survivalRows.push({
            runId: run.id,
            dungeonSlug: canonicalDungeonKey(run.dungeon.slug),
            dungeonName: run.dungeon.name,
            keyLevel: run.keyLevel,
            summary,
            fromCache: false,
          });
          usedSurvivalRunIds.add(run.id);
          usedReportFightKeys.add(reportFightKey);
          acceptedForDungeon += 1;
          if (lateBound) {
            const selected = survivalRunSelection.selectedRuns.find(
              (e) => e.canonicalRunId === run.id,
            );
            if (selected) selected.wclReportMatched = true;
          }
        } catch (error) {
          if (isEnrichmentSoftSkip(error)) {
            survivalCost.rejectedCandidates.push({
              reason: "survival_canonical_soft_skip",
              runId: run.id,
              dungeonSlug,
            });
            continue;
          }
          survivalRequiredFailed = true;
          await failHard("analyze-run", error);
        }
      }
    }
  }

  const selectedRunCount = scoringRunSelection.selectedRuns.length;
  const matchedReportCount = runDiagnostics.filter((d) => d.wclReportMatched === true).length;
  const usableCombatRunCount = runDiagnostics.filter((d) => d.detailedAnalysis === true).length;
  const detailedRunCount = usableCombatRunCount;

  const presentationMetaByRunId: Record<
    string,
    {
      dungeonName: string;
      wclReportMatched: boolean;
      wclCoverageRatio: number | null;
      hasDetailedAnalysis: boolean;
    }
  > = {};
  const dungeonNamesBySlug: Record<string, string> = {};
  for (const entry of scoringRunSelection.selectedRuns) {
    const row = persistedRuns.find((r) => r.id === entry.canonicalRunId);
    const diag = runDiagnostics.find((d) => String(d.runId) === entry.canonicalRunId);
    const coverage = runCoverageById[entry.canonicalRunId];
    const dungeonName = row?.dungeon.name ?? entry.dungeonSlug;
    dungeonNamesBySlug[entry.dungeonSlug] = dungeonName;
    presentationMetaByRunId[entry.canonicalRunId] = {
      dungeonName,
      wclReportMatched: Boolean(diag?.wclReportMatched),
      wclCoverageRatio: typeof coverage === "number" ? coverage : null,
      hasDetailedAnalysis: Boolean(diag?.detailedAnalysis),
    };
  }
  scoringRunSelection = applyRunMetadataToSelection(scoringRunSelection, presentationMetaByRunId);
  const contractScoringRunSelection = toContractScoringRunSelection(
    scoringRunSelection,
    presentationMetaByRunId,
    dungeonNamesBySlug,
  );

  const seasonPrune = await repositories.run.pruneOtherSeasonParticipations(
    character.id,
    season.id,
  );
  if (seasonPrune.deletedRuns > 0 || seasonPrune.detachedParticipations > 0) {
    logger.info(
      {
        identity,
        detachedOtherSeasonParticipations: seasonPrune.detachedParticipations,
        deletedOtherSeasonRuns: seasonPrune.deletedRuns,
      },
      "refresh pipeline: pruned other-season run participations",
    );
  }

  // Character-level WCL visibility + data-state even when zero runs / no analysis target.
  // Never overwrite PUBLIC/HIDDEN visibility with a matching outcome such as NO_MATCHED_RUN.
  if (wclVisibility !== null || wclDataState !== null) {
    wclDataState = refineWclDataState({
      visibility: wclVisibility,
      baseDataState: wclDataState,
      combatFactsCount: combatFactsList.length,
      dungeonAggregateCount: wclDungeonAggregates.length,
    });
    const performanceOkForSuccess =
      wclPerformanceRecord?.state === "OK" ||
      wclPerformanceRecord?.state === "SKIPPED" ||
      wclPerformanceRecord == null;
    const survivalCandidatesWithWcl =
      survivalRows.length > 0 ||
      survivalBindPool.length > 0 ||
      survivalRunSelection.selectedRuns.some((e) => e.wclReportMatched);
    const survivalOkForSuccess =
      !survivalRequiredFailed &&
      (!survivalCandidatesWithWcl || survivalRows.length > 0);
    const wclOkForSuccess = performanceOkForSuccess && survivalOkForSuccess;
    const visibilitySummary = {
      wclVisibility,
      wclDataState,
      discoveredRunCount: discoveredRuns.length,
      matchedSelectedRuns: detailedRunCount,
      matchedPairCount: fusion.matchedPairCount,
      mergedCanonicalRunCount: volumeRunCount,
      unresolvedCrossProviderMatches: fusion.unresolvedCrossProviderMatches,
      reconciledDuplicateGroups: reconcileResult.mergedGroups,
      reconciledDeletedRuns: reconcileResult.deletedRunCount,
      prunedOtherSeasonParticipations: seasonPrune.detachedParticipations,
      prunedOtherSeasonRuns: seasonPrune.deletedRuns,
      performanceState: wclPerformanceRecord?.state ?? null,
      performanceAdapterVersion: POINTS_AND_DAMAGE_ADAPTER_VERSION,
      rejectedLegacyCache: wclRejectedLegacyCache,
      survivalAnalyzedRunCount: survivalRows.length,
      survivalCachedRunCount: survivalRows.filter((r) => r.fromCache).length,
      survivalNewlyFetchedRunCount: survivalRows.filter((r) => !r.fromCache).length,
      survivalRequiredFailed,
      survivalAdapterVersion: SURVIVAL_STANDALONE_V1_1_1_CONFIG.adapterVersion,
      survivalConfigVersion: SURVIVAL_STANDALONE_V1_1_1_CONFIG.version,
      survivalRequestCost: survivalCost,
    };
    // Always persist character-level provider visibility (including zero matched runs).
    // Preserve Performance + Survival success gating — do not stamp lastSuccessAt over a failed required dataset.
    await repositories.providerState.upsert({
      characterId: character.id,
      provider: "warcraftlogs",
      state: wclOkForSuccess
        ? mapWclVisibilityToState(wclVisibility, wclDataState)
        : "UNAVAILABLE",
      detail: wclOkForSuccess
        ? undefined
        : !performanceOkForSuccess
          ? `points_and_damage Performance unavailable (${wclPerformanceRecord?.state ?? "missing"})`
          : "Survival V1.1.1 required datasets failed",
      wclVisibility,
      lastAttemptAt: now,
      ...(wclOkForSuccess ? { lastSuccessAt: now } : {}),
      fetchedAt: now,
      metadata: visibilitySummary,
    });
    if (combatFactsList.length === 0) {
      const anyRun =
        persistedRuns[0] ?? (await repositories.run.findLatestForCharacter(character.id));
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
      }
    }
  }

  // ── Extract metrics ─────────────────────────────────────────────────────
  const observedAt = now.toISOString();
  const observations: MetricObservationDTO[] = [];

  // Mythic rating is emitted later via CHARACTER_HISTORY experience builder.
  void mythicKeystoneScore;

  const roleSlug = (character.role ?? blizzardProfile?.role ?? raiderIoProfile?.role ?? null)
    ?.toString()
    .toLowerCase();
  const specSlug =
    blizzardProfile?.specSlug ?? raiderIoProfile?.specSlug ?? null;

  const classSlug = blizzardProfile?.classSlug ?? raiderIoProfile?.classSlug ?? null;

  const parseByRunId = new Map(
    runDiagnostics.map((d) => [String(d.runId), d.parse as { parsePercentile?: number | null } | undefined]),
  );

  const explanatoryRuns = scoringRunSelection.selectedRuns.map((entry) => {
    const fused = fusedRuns.find((r) => r.id === entry.canonicalRunId);
    const parse = parseByRunId.get(entry.canonicalRunId);
    return {
      runId: entry.canonicalRunId,
      dungeonSlug: entry.dungeonSlug,
      keyLevel: entry.keyLevel,
      completedAt: entry.completedAt,
      timed: entry.timed ?? false,
      parsePercentile: parse?.parsePercentile ?? null,
      scoreValue: entry.raiderIoScore ?? fused?.scoreValue ?? null,
      hasWclSource: entry.wclReportMatched,
    };
  });

  const selectedRunWclCoverage =
    selectedRunCount > 0 ? detailedRunCount / selectedRunCount : 0;

  // Performance uses points_and_damage aggregates only — never fight-bound parse fallback.
  // Missing dungeons reduce coverage; never invent zero percentiles.
  const performanceOk =
    wclPerformanceRecord?.state === "OK" && wclDungeonAggregates.length > 0;
  const activeWclAggregates = performanceOk
    ? wclDungeonAggregates.filter(
        (d) =>
          activeDungeonSlugs.length === 0 ||
          activeDungeonSlugs.includes(canonicalDungeonKey(d.dungeonSlug)),
      )
    : [];
  const performanceProvenance =
    activeWclAggregates.length > 0 ? "AGGREGATE_ZONE_RANKINGS" : "NONE";

  const wclPerformance = buildWclPerformanceObservations({
    currentSeasonDungeons: activeWclAggregates.map((d) => ({
      dungeonSlug: d.dungeonSlug,
      dungeonName: d.dungeonName,
      encounterId: d.encounterId,
      bestParsePercentile: d.bestParsePercentile,
      medianParsePercentile: d.medianParsePercentile,
      loggedRunCount: d.loggedRunCount,
      specSlug: d.specSlug,
      roleSlug: d.roleSlug,
      keystoneLevel: d.keystoneLevel,
      throughputBracket: d.throughputBracket,
      ratingPoints: d.ratingPoints,
      scoreRank: d.scoreRank,
      regionRank: d.regionRank,
      serverRank: d.serverRank,
      scoreRankPercent: d.scoreRankPercent,
      specialization: d.specialization,
      bestDps: d.bestDps,
      completion: d.completion,
    })),
    expectedDungeonCount,
    activeSpecSlug: specSlug,
    activeRoleSlug: roleSlug,
    hasResolvedSpecAndRole: Boolean(specSlug && roleSlug),
    // Aggregate Performance is independent of report matching / combat ingestion.
    selectedRunWclCoverage:
      performanceProvenance === "AGGREGATE_ZONE_RANKINGS" ? 1 : selectedRunWclCoverage,
    explanatoryRuns,
    logFreshness:
      performanceProvenance === "AGGREGATE_ZONE_RANKINGS"
        ? 0.85
        : wclVisibility === "PUBLIC" &&
            (wclDataState === "MATCHED_COMBAT_LOGS" ||
              wclDataState === "RANKINGS_ONLY" ||
              wclDataState === "NO_MATCHED_RUN")
          ? 0.85
          : 0.4,
    observedAt,
  });
  wclPerformance.summary.currentSeason.provenance = performanceProvenance;
  wclPerformance.summary.currentSeason.availableDungeonCount =
    wclPerformance.summary.currentSeason.dungeonCount;
  if (wclPerformanceRecord?.global) {
    wclPerformance.summary.currentSeason.totalMythicPlusScore =
      wclPerformanceRecord.global.totalMythicPlusScore;
    wclPerformance.summary.currentSeason.totalLoggedRuns =
      wclPerformanceRecord.global.totalLoggedRuns;
    wclPerformance.summary.currentSeason.partition = wclPerformanceRecord.global.partition;
    wclPerformance.summary.currentSeason.zoneId = wclPerformanceRecord.global.zoneId;
    wclPerformance.summary.currentSeason.specRanks =
      wclPerformanceRecord.global.specRanks as typeof wclPerformance.summary.currentSeason.specRanks;
  }
  wclPerformance.summary.currentSeason.diagnostics = {
    ratingPointsExcludedFromScore: true,
    keystoneLevelExcludedFromScore: true,
    scoreRankPercentExcludedFromScore: true,
    throughputSampleCountUnavailable: true,
    performanceState: wclPerformanceRecord?.state ?? null,
    unavailableEncounters: Array.isArray(wclPerformanceRecord?.diagnostics?.unavailableEncounters)
      ? (wclPerformanceRecord!.diagnostics!.unavailableEncounters as Array<{
          encounterID: number;
          encounterName: string | null;
          dungeonSlug: string | null;
          reason: string;
        }>)
      : undefined,
  };
  observations.push(...wclPerformance.observations);

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

  const roleForCatalog =
    roleSlug === "tank" ? "TANK" : roleSlug === "healer" ? "HEALER" : "DPS";
  const abilityCatalog = getAbilityCatalog({
    classSlug,
    specSlug,
    role: roleForCatalog,
    includeShared: true,
    includeRacials: false,
  });
  const catalogDiagnostics = buildCatalogCoverageDiagnostics({
    classSlug,
    specSlug,
    role: roleForCatalog,
    includeShared: true,
    includeRacials: false,
  });

  const perRunCombatObservations = [...combatFactsByRunId.entries()].map(([runId, facts]) => {
    const runRow = selectedRunRows.get(runId);
    return extractMetricsFromCombatFacts(facts, observedAt, {
      dungeonSlug: runRow?.dungeon.slug ?? "unknown",
      runDurationMs: runRow?.durationMs ?? 1_800_000,
      classSlug,
      specSlug,
      catalog: abilityCatalog,
    });
  });
  observations.push(
    ...aggregateCombatObservations(perRunCombatObservations, observedAt, {
      selectedRunCount,
      detailedRunCount,
    }).filter((o) => !o.metricKey.startsWith("survival.")),
  );

  const mythicRatingObs =
    mythicKeystoneScore !== null
      ? buildMythicRatingObservation({
          mythicRating: mythicKeystoneScore,
          observedAt,
          cutoffs: seasonCutoffs,
        })
      : null;

  // EXPERIENCE from CHARACTER_HISTORY only — independent of WCL detailed analysis.
  observations.push(
    ...buildCharacterHistoryExperienceObservations({
      observedAt,
      expectedDungeonCount,
      selectedRuns: scoringRunSelection.selectedRuns.map((r) => ({
        dungeonSlug: r.dungeonSlug,
        keyLevel: r.keyLevel,
        timed: r.timed,
        completedAt: r.completedAt,
        scoreValue: r.raiderIoScore ?? null,
      })),
      mythicRatingObservation: mythicRatingObs,
      priorSeasonCount: raiderIoProfile?.previousSeason ? 1 : 0,
      roleContinuity: character.role ? 1 : null,
      sourceProvider: "character_history",
    }),
  );

  const authenticityFeatures = boostFacts ? mapBoostFactsToAuthenticity(boostFacts) : undefined;
  // Coverage is actual combat-facts analysis over selected runs — never invent 1.0 or treat
  // zero coverage as evidence that logs are hidden.
  const selectedRunCoverage = selectedRunCount > 0 ? detailedRunCount / selectedRunCount : 0;
  const freshness =
    wclVisibility === "HIDDEN"
      ? 0.35
      : wclDataState === "NO_PUBLIC_LOGS" ||
          wclDataState === "RATE_LIMITED" ||
          wclDataState === "UNAVAILABLE"
        ? 0.45
        : stagesSkipped.includes("refresh-raiderio") || stagesSkipped.includes("refresh-warcraftlogs-summary")
          ? 0.55
          : 0.75;

  const wclSurvival = buildWclSurvivalObservations({
    rows: survivalRows,
    expectedDungeonCount,
    observedAt,
    selectedRunWclCoverage: (() => {
      const slots = Math.max(survivalRunSelection.selectedRuns.length, survivalRows.length);
      return slots > 0 ? survivalRows.length / slots : 0;
    })(),
    logFreshness: freshness,
    requestCost: survivalCost,
    lateBoundRunCount: survivalLateBoundRunCount,
    bindPoolSize: survivalBindPool.length,
  });
  observations.push(...wclSurvival.observations);

  // Season already resolved above for run persistence.
  const scoreCalculatedAt = new Date();
  const observedAtForScore = scoreCalculatedAt.toISOString();
  // Rebuild survival observations with final freshness, then persist metrics using score clock.
  for (const obs of wclSurvival.observations) {
    obs.observedAt = observedAtForScore;
  }
  await repositories.metric.replaceObservations(character.id, season.id, observations);

  // ── Calculate + structurally validate score ─────────────────────────────
  const model = await repositories.score.getActiveModel(container.env.ACTIVE_SCORE_MODEL_KEY);
  if (!model) {
    const error = new Error(`No active score model found for key "${container.env.ACTIVE_SCORE_MODEL_KEY}"`);
    await repositories.job.markFailed(job.id, error);
    terminalized = true;
    throw error;
  }

  const modelConfig = {
    ...(model.config as unknown as ScoreModelConfig & Record<string, unknown>),
    version: model.version,
    key: model.key,
    metricWeights: {
      ...((model.config as { metricWeights?: Record<string, unknown> }).metricWeights ?? {}),
      PERFORMANCE: wclPerformance.performanceMetricWeights,
      SURVIVAL: wclSurvival.survivalMetricWeights,
    },
  } as ScoreModelConfig;

  const refreshContract = buildRefreshContract({
    scoringModelKey: model.key,
    scoringModelVersion: model.version,
    activeSeasonId: season.slug,
    env: process.env,
    allowFixtureZoneDefault:
      container.env.APP_ENV === "test" ||
      container.env.NODE_ENV === "test" ||
      container.env.PROVIDER_MODE === "fixture",
  });

  const scoreDto = container.calculateScore({
    characterId: character.id,
    seasonSlug: season.slug,
    model: modelConfig,
    scopeType: "CHARACTER",
    scopeKey: null,
    observations,
    calculatedAt: scoreCalculatedAt.toISOString(),
    inputFingerprint: fingerprintObservations(character.id, model.key, model.version, observations, {
      refreshContract,
      scoringRunSelectionKey: buildScoringRunSelectionKey(scoringRunSelection.selectedRuns),
      forceRefreshToken: jobPayload.forceRefresh ? jobPayload.requestedAt : null,
    }),
    context: {
      role: character.role ?? blizzardProfile?.role ?? raiderIoProfile?.role ?? "DPS",
      freshness,
      selectedRunCoverage,
      wclVisibility,
      matchedWclRunCount: combatFactsList.length,
      authenticity: authenticityFeatures,
      mechanicCatalogVersion: refreshContract.mechanicCatalogVersion,
    },
  });
  logger.info(
    {
      ...logBase,
      event: OBS_EVENTS.refreshScoreCalculated,
      modelKey: model.key,
      modelVersion: model.version,
      scoreConfidence: scoreDto.confidence,
      observationCount: observations.length,
      dimensionCoverage: scoreDto.dimensions.map((d) => d.dimension),
    },
    OBS_EVENTS.refreshScoreCalculated,
  );

  // Override PERFORMANCE dimension confidence with independent WCL confidence when scored.
  if (wclPerformance.observations.length > 0) {
    for (const dim of scoreDto.dimensions) {
      if (dim.dimension === "PERFORMANCE") {
        dim.confidence = wclPerformance.confidence;
        if (dim.score != null && dim.confidence > 0) {
          dim.state = dim.confidence < 0.35 ? "PARTIAL" : "AVAILABLE";
          dim.reason = dim.state === "PARTIAL" ? "INCOMPLETE_COVERAGE" : null;
        }
      }
    }
  } else {
    for (const dim of scoreDto.dimensions) {
      if (dim.dimension === "PERFORMANCE") {
        dim.confidence = 0;
        dim.score = null;
        dim.state = "UNAVAILABLE";
        dim.reason = "NO_WCL_PERFORMANCE_OBSERVATIONS";
      }
    }
  }

  const providerStates = await repositories.providerState.listForCharacter(character.id);
  const timestampFor = (provider: "blizzard" | "raiderio" | "warcraftlogs") =>
    providerStates.find((s) => s.provider === provider)?.fetchedAt ?? null;

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
            blizzard: timestampFor("blizzard") ?? (blizzardProfile ? now.toISOString() : null),
            raiderio: timestampFor("raiderio") ?? (raiderIoProfile ? now.toISOString() : null),
            warcraftlogs:
              timestampFor("warcraftlogs") ?? (wclVisibility != null ? now.toISOString() : null),
          },
          warnings: fusionWarnings,
          disagreements,
          excludedObservations,
          confidence: scoreDto.confidence,
          coverage: {
            selectedRunCoverage,
            freshness,
            selectedRunCount,
            detailedRunCount,
            analysisAttemptedCount,
            matchedReportCount,
            usableCombatRunCount,
            availableModelWeight: scoreDto.availableModelWeight,
            totalModelWeight: scoreDto.totalModelWeight,
            modelCoverageRatio: scoreDto.modelCoverageRatio,
            overallState: scoreDto.overallState,
            provisionalReason: scoreDto.provisionalReason,
          },
          scoringRunSelection: contractScoringRunSelection,
          runDiagnostics,
          runCoverageById,
          seasonSlug: season.slug,
          fusedRunCount: fusedRuns.length,
          wclVisibility,
          wclDataState,
          performanceSummary: wclPerformance.summary,
          survivalSummary: wclSurvival.summary,
          rawZoneRankingsPointsAndDamage: wclPerformanceRecord?.raw ?? null,
          abilityCatalog: catalogDiagnostics,
          historyMode: "CHARACTER_HISTORY",
          refreshContract,
          refreshContractHash: hashRefreshContract(refreshContract),
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
    terminalized = true;
    throw error;
  }

  // Fan-in batch: record selected-run terminal states then publish once.
  const analysisBatch = await repositories.analysisBatch.createBatch({
    characterId: character.id,
    seasonId: season.id,
    refreshId: job.id,
    scoreModelId: model.id,
    runIds: scoringRunSelection.selectedRuns.map((r) => r.canonicalRunId),
    deadlineAt: new Date(now.getTime() + 15 * 60_000),
    metadata: {
      selectedRunCount,
      detailedRunCount,
      catalogVersion: abilityCatalog.catalogVersion,
      catalogSupported: abilityCatalog.supported,
    },
  });

  for (const entry of scoringRunSelection.selectedRuns) {
    const diag = runDiagnostics.find((d) => String(d.runId) === entry.canonicalRunId);
    const detailed = Boolean(diag?.detailedAnalysis);
    const status = detailed
      ? ("SUCCEEDED" as const)
      : entry.wclReportMatched
        ? ("FAILED" as const)
        : ("UNAVAILABLE" as const);
    await repositories.analysisBatch.markRunStatus({
      batchId: analysisBatch.id,
      runId: entry.canonicalRunId,
      status,
      terminalReason: detailed
        ? null
        : String(diag?.reason ?? (entry.wclReportMatched ? "ANALYZE_FAILED" : "NO_WCL_SOURCE")),
    });
  }

  const claimed = await repositories.analysisBatch.claimFinalization(analysisBatch.id);
  if (!claimed) {
    logger.warn(
      { batchId: analysisBatch.id, characterId: character.id },
      "refresh pipeline: finalization claim skipped (duplicate or not ready)",
    );
  }

  await repositories.score.saveScoreSnapshot({
    characterId: character.id,
    seasonId: season.id,
    scoreModelId: model.id,
    scopeType: "CHARACTER",
    scopeKey: null,
    snapshot: enrichedScore,
    publish: true,
    analysisBatchId: analysisBatch.id,
  });

  if (claimed) {
    await repositories.analysisBatch.markFinalized(analysisBatch.id);
  }

  character = await repositories.character.updateRefreshTimestamps(character.id, {
    lastSeenAt: now,
    lastPublicRefreshAt: now,
  });
  job = await repositories.job.markCompleted(job.id);
  terminalized = true;
  logger.info(
    {
      ...logBase,
      event: OBS_EVENTS.refreshPersistenceCompleted,
      jobId: job.id,
      characterId: character.id,
      fusedRunCount: fusedRuns.length,
    },
    OBS_EVENTS.refreshPersistenceCompleted,
  );
  logger.info(
    {
      ...logBase,
      event: OBS_EVENTS.refreshTerminal,
      jobId: job.id,
      status: "COMPLETED",
      stagesSkipped,
    },
    OBS_EVENTS.refreshTerminal,
  );

  return {
    character,
    job,
    score: enrichedScore,
    stagesSkipped,
    notFound: false,
    disagreements,
    excludedObservations,
  };
  } catch (error) {
    await ensureFailed(error);
    logger.warn(
      {
        ...logBase,
        event: OBS_EVENTS.refreshTerminal,
        jobId: job.id,
        status: "FAILED",
      },
      OBS_EVENTS.refreshTerminal,
    );
    throw error;
  }
}
