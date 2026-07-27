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
  type WclDataState,
  refineWclDataState,
  normalizeWclProvenance,
} from "@mplus/contracts";
import { extractBoostSupportFacts } from "@mplus/provider-raiderio";
import type { RunCombatFacts, WclReportFightDetails } from "@mplus/provider-warcraftlogs";
import { validateScoreSnapshot } from "@mplus/test-utils";
import type { WorkerContainer } from "../container.js";
import { refreshCharacterDedupeKey } from "../dedupe.js";
import { negativeCache } from "../negative-cache.js";
import { ensureBlizzardCurrentSeason, ensureCurrentSeason } from "../persistence/run-repository.js";
import { mapBoostFactsToAuthenticity } from "./boost-authenticity.js";
import { extractMetricsFromCombatFacts } from "./combat-metrics.js";
import { fingerprintObservations } from "./fingerprint.js";
import { buildMythicRatingObservation } from "./performance-metrics.js";
import { buildWclPerformanceObservations } from "./wcl-performance-metrics.js";
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
  collectRaiderIoRuns,
  ensureTargetParticipant,
  filterRunsToActiveWindow,
  fuseCrossProviderRuns,
} from "./run-fusion.js";

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
    return {
      visibility: normalized.visibility,
      dataState: normalized.dataState ?? parseSummaryDataState(summary.data),
      dungeonAggregates: summary.data.dungeonAggregates ?? [],
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
        }
      | Promise<{
          summary: { visibility: WclVisibilityState | null; dataState?: WclDataState };
          dungeonAggregates?: WclDungeonPerformanceAggregateDTO[];
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
    };
  }

  return { visibility: null, dataState: null, dungeonAggregates: [] };
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

  const dedupeKey = refreshCharacterDedupeKey(jobPayload);
  const { job: createdJob } = await repositories.job.createOrGetByDedupe({
    jobType: "refresh-character",
    dedupeKey,
    payload: jobPayload,
  });
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
      return { visibility: null, dataState: null, runs: [], dungeonAggregates: [] };
    }

    const wclCtx: ProviderFetchContext = {
      ...ctx,
      wclHydrationHints: hydrationHints,
    };

    let visibility: WclVisibilityState | null = null;
    let dataState: WclDataState | null = null;
    let dungeonAggregates: WclDungeonPerformanceAggregateDTO[] = [];
    try {
      const summary = await resolveWclSummary(
        providers.warcraftlogs,
        identity,
        wclCtx,
        async (result) => {
          await recordProviderResult(repositories, result);
        },
      );
      visibility = summary.visibility;
      dataState = summary.dataState;
      dungeonAggregates = summary.dungeonAggregates;

      const runsResult = await providers.warcraftlogs.discoverCharacterRuns(identity, wclCtx);
      await recordProviderResult(repositories, runsResult);

      // Coverage outcomes live on dataState — visibility stays PUBLIC/HIDDEN/null only.
      await repositories.providerState.upsert({
        characterId: character.id,
        provider: "warcraftlogs",
        state: mapWclVisibilityToState(visibility, dataState),
        wclVisibility: visibility,
        lastAttemptAt: now,
        lastSuccessAt: now,
        fetchedAt: now,
        expiresAt: runsResult.freshness.expiresAt ? new Date(runsResult.freshness.expiresAt) : null,
        metadata: {
          wclDataState: dataState,
          discoveredRunCount: runsResult.data.length,
          hydrationHintCount: hydrationHints.length,
          dungeonAggregateCount: dungeonAggregates.length,
        },
      });
      return { visibility, dataState, runs: runsResult.data, dungeonAggregates };
    } catch (error) {
      // WCL is enrichment-only: never block a Blizzard/Raider.IO-backed MVP score.
      // GraphQL schema / invalid-response errors stay UNAVAILABLE with detail.
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
        metadata: { wclDataState: failedDataState },
      });
      logger.info({ identity, err: error }, "refresh pipeline: WCL soft-skipped");
      return { visibility, dataState: failedDataState, runs: [], dungeonAggregates };
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
  let fusedRuns = fusion.runs.map((run) =>
    ensureTargetParticipant(
      {
        ...run,
        // Current-season refresh always persists under the resolved Blizzard season identity.
        seasonSlug: season.slug,
      },
      identity,
    ),
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
    });
  }

  const reconcileResult = await repositories.run.reconcileDuplicateRunsForCharacter(
    character.id,
    season.id,
  );
  const seasonPrune = await repositories.run.pruneOtherSeasonParticipations(
    character.id,
    season.id,
  );
  if (reconcileResult.deletedRunCount > 0 || seasonPrune.deletedRuns > 0) {
    logger.info(
      {
        identity,
        mergedGroups: reconcileResult.mergedGroups,
        deletedRunCount: reconcileResult.deletedRunCount,
        detachedOtherSeasonParticipations: seasonPrune.detachedParticipations,
        deletedOtherSeasonRuns: seasonPrune.deletedRuns,
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

  // Character-level WCL visibility + data-state even when zero runs / no analysis target.
  // Never overwrite PUBLIC/HIDDEN visibility with a matching outcome such as NO_MATCHED_RUN.
  if (wclVisibility !== null || wclDataState !== null) {
    wclDataState = refineWclDataState({
      visibility: wclVisibility,
      baseDataState: wclDataState,
      combatFactsCount: combatFactsList.length,
      dungeonAggregateCount: wclDungeonAggregates.length,
    });
    const visibilitySummary = {
      wclVisibility,
      wclDataState,
      discoveredRunCount: discoveredRuns.length,
      matchedSelectedRuns: combatFactsList.length,
      matchedPairCount: fusion.matchedPairCount,
      mergedCanonicalRunCount: volumeRunCount,
      unresolvedCrossProviderMatches: fusion.unresolvedCrossProviderMatches,
      reconciledDuplicateGroups: reconcileResult.mergedGroups,
      reconciledDeletedRuns: reconcileResult.deletedRunCount,
      prunedOtherSeasonParticipations: seasonPrune.detachedParticipations,
      prunedOtherSeasonRuns: seasonPrune.deletedRuns,
    };
    // Always persist character-level provider visibility (including zero matched runs).
    await repositories.providerState.upsert({
      characterId: character.id,
      provider: "warcraftlogs",
      state: mapWclVisibilityToState(wclVisibility, wclDataState),
      wclVisibility,
      lastAttemptAt: now,
      lastSuccessAt: now,
      fetchedAt: now,
      metadata: visibilitySummary,
    });
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

  const roleSlug = (character.role ?? blizzardProfile?.role ?? raiderIoProfile?.role ?? null)
    ?.toString()
    .toLowerCase();
  const specSlug =
    blizzardProfile?.specSlug ?? raiderIoProfile?.specSlug ?? null;

  const explanatoryRuns = fusedRuns.map((run) => ({
    runId: run.id,
    dungeonSlug: run.dungeonSlug,
    keyLevel: run.keyLevel,
    completedAt: run.completedAt,
    timed: run.timed,
    parsePercentile: null as number | null,
    scoreValue: run.scoreValue,
    hasWclSource: run.sources.some((s) => s.provider === "WARCRAFT_LOGS"),
  }));

  const wclPerformance = buildWclPerformanceObservations({
    currentSeasonDungeons: wclDungeonAggregates.map((d) => ({
      dungeonSlug: d.dungeonSlug,
      dungeonName: d.dungeonName,
      bestParsePercentile: d.bestParsePercentile,
      medianParsePercentile: d.medianParsePercentile,
      loggedRunCount: d.loggedRunCount,
      specSlug: d.specSlug,
      roleSlug: d.roleSlug,
    })),
    expectedDungeonCount: season.dungeonCount > 0 ? season.dungeonCount : 8,
    activeSpecSlug: specSlug,
    activeRoleSlug: roleSlug,
    hasResolvedSpecAndRole: Boolean(specSlug && roleSlug),
    selectedRunWclCoverage:
      selectedRuns.size > 0 ? combatFactsList.length / selectedRuns.size : 0,
    explanatoryRuns,
    logFreshness:
      wclVisibility === "PUBLIC" &&
      (wclDataState === "MATCHED_COMBAT_LOGS" ||
        wclDataState === "RANKINGS_ONLY" ||
        wclDataState === "NO_MATCHED_RUN")
        ? 0.85
        : 0.4,
    observedAt,
  });
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

  for (const facts of combatFactsList) {
    observations.push(...extractMetricsFromCombatFacts(facts, observedAt));
  }

  const runVolume = volumeRunCount;
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
        fusedRuns: fusion.mergedCanonicalRunCount,
        canonicalRunCount: volumeRunCount,
        matchedPairCount: fusion.matchedPairCount,
        unresolvedCrossProviderMatches: fusion.unresolvedCrossProviderMatches,
        wclVisibility,
        derivedFrom: "canonical_run_volume",
      },
    });
  }

  const authenticityFeatures = boostFacts ? mapBoostFactsToAuthenticity(boostFacts) : undefined;
  // Coverage is actual combat-facts analysis over selected runs — never invent 1.0 or treat
  // zero coverage as evidence that logs are hidden.
  const selectedRunCoverage =
    selectedRuns.size > 0 ? combatFactsList.length / selectedRuns.size : 0;
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

  // Season already resolved above for run persistence.
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
    },
  } as ScoreModelConfig;

  const scoreDto = container.calculateScore({
    characterId: character.id,
    seasonSlug: season.slug,
    model: modelConfig,
    scopeType: "CHARACTER",
    scopeKey: null,
    observations,
    calculatedAt: now.toISOString(),
    inputFingerprint: fingerprintObservations(character.id, model.key, model.version, observations),
    context: {
      role: character.role ?? blizzardProfile?.role ?? raiderIoProfile?.role ?? "DPS",
      freshness,
      selectedRunCoverage,
      wclVisibility,
      matchedWclRunCount: combatFactsList.length,
      authenticity: authenticityFeatures,
    },
  });

  // Override PERFORMANCE dimension confidence with independent WCL confidence when scored.
  if (wclPerformance.observations.length > 0) {
    for (const dim of scoreDto.dimensions) {
      if (dim.dimension === "PERFORMANCE") {
        dim.confidence = wclPerformance.confidence;
      }
    }
  } else {
    for (const dim of scoreDto.dimensions) {
      if (dim.dimension === "PERFORMANCE") {
        dim.confidence = 0;
        dim.score = (modelConfig as { confidenceNeutralScore?: number }).confidenceNeutralScore ?? 50;
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
          coverage: { selectedRunCoverage, freshness },
          seasonSlug: season.slug,
          fusedRunCount: fusedRuns.length,
          wclVisibility,
          wclDataState,
          performanceSummary: wclPerformance.summary,
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
  terminalized = true;

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
    throw error;
  }
}
