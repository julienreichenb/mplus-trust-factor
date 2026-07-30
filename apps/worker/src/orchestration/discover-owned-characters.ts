import {
  OWNED_CHARACTER_RELEVANCE_POLICY_V1,
  buildFreshnessConfig,
  evaluateOwnedCharacterAutoRefreshEligibilityV1,
  evaluateOwnedCharacterRelevanceV1,
  isDatasetFresh,
  slugFromBlizzardPlayableClassId,
  type RelevanceReason,
} from "@mplus/config";
import {
  QUEUE_NAMES,
  type DiscoverOwnedCharactersJob,
  type RegionCode,
} from "@mplus/contracts";
import type { Prisma, Season } from "@mplus/database";
import type { WorkerContainer } from "../container.js";
import type { QueueProducers } from "../queues.js";
import { ensureBlizzardCurrentSeason } from "../persistence/run-repository.js";
import { mapWithConcurrency } from "./concurrency.js";

export interface DiscoveryCounters {
  ownershipCount: number;
  maxLevelCount: number;
  ratingCheckedCount: number;
  relevantCount: number;
  irrelevantCount: number;
  autoRefreshEligibleCount: number;
  existingFreshScoreCount: number;
  refreshQueuedCount: number;
  alreadyQueuedCount: number;
  failedCount: number;
  providerRequestCount: number;
}

const RATING_CONCURRENCY = 2;
/** Retain last successful rating for this window when a fetch fails. */
const RATING_STALE_RETENTION_MS = 7 * 86_400_000;

function emptyCounters(): DiscoveryCounters {
  return {
    ownershipCount: 0,
    maxLevelCount: 0,
    ratingCheckedCount: 0,
    relevantCount: 0,
    irrelevantCount: 0,
    autoRefreshEligibleCount: 0,
    existingFreshScoreCount: 0,
    refreshQueuedCount: 0,
    alreadyQueuedCount: 0,
    failedCount: 0,
    providerRequestCount: 0,
  };
}

function asReasonArray(value: unknown): RelevanceReason[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is RelevanceReason => typeof v === "string") as RelevanceReason[];
}

type RegionalSeasonCache = {
  seasonId: number;
  slug: string;
  source: "season_index.current_season" | "season_index.last";
  season: Season;
};

/**
 * Account-character discovery: cheap relevance evaluation → ensure Character rows →
 * enqueue refresh-character only for strictly auto-refresh-eligible characters.
 * Never calls WCL. Never mutates regional season from character profile seasons[].
 */
export async function runDiscoverOwnedCharacters(
  container: WorkerContainer,
  job: DiscoverOwnedCharactersJob,
  producers: Pick<QueueProducers, "enqueueRefreshCharacter">,
): Promise<{ counters: DiscoveryCounters }> {
  const { prisma, providers, env, logger, repositories } = container;
  const counters = emptyCounters();
  const policy = OWNED_CHARACTER_RELEVANCE_POLICY_V1;
  const freshness = buildFreshnessConfig(env);
  const startedAt = new Date();

  const account = await prisma.battleNetAccount.findUnique({
    where: { id: job.battleNetAccountId },
  });
  if (!account || account.unlinkedAt) {
    logger.info(
      { battleNetAccountId: job.battleNetAccountId },
      "discover-owned-characters skipped: account missing or unlinked",
    );
    return { counters };
  }

  await prisma.battleNetAccount.update({
    where: { id: account.id },
    data: {
      lastDiscoveryStatus: "RUNNING",
      lastDiscoveryStartedAt: startedAt,
      lastDiscoveryError: null,
      lastDiscoveryOwnershipSyncAt: new Date(job.ownershipSyncAt),
    },
  });

  try {
    const scoreModel = await repositories.score.getActiveModel(env.ACTIVE_SCORE_MODEL_KEY);
    const regionalSeasonByCode = new Map<string, RegionalSeasonCache>();
    const regionalSeasonInflight = new Map<string, Promise<RegionalSeasonCache>>();

    const resolveRegionalSeason = async (
      regionCode: string,
      regionId: string,
      requestId: string,
    ): Promise<RegionalSeasonCache> => {
      const key = regionCode.toUpperCase();
      const cached = regionalSeasonByCode.get(key);
      if (cached) return cached;

      const inflight = regionalSeasonInflight.get(key);
      if (inflight) return inflight;

      const pending = (async (): Promise<RegionalSeasonCache> => {
        const previous = await prisma.season.findFirst({
          where: { regionId, isCurrent: true },
          select: { id: true, slug: true, blizzardSeasonId: true },
        });

        const ctx = {
          region: regionCode.toLowerCase() as RegionCode,
          requestId,
          correlationId: job.correlationId ?? null,
          forceRefresh: false,
          now: new Date().toISOString(),
        };
        const authoritative = await providers.blizzard.resolveAuthoritativeCurrentSeasonId(ctx);
        counters.providerRequestCount += 1;

        const season = await ensureBlizzardCurrentSeason(
          prisma,
          regionId,
          authoritative.data.seasonId,
        );

        const entry: RegionalSeasonCache = {
          seasonId: authoritative.data.seasonId,
          slug: authoritative.data.slug,
          source: authoritative.data.source,
          season,
        };
        regionalSeasonByCode.set(key, entry);

        logger.info(
          {
            triggerSource: "ACCOUNT_DISCOVERY",
            region: key,
            authoritativeSeasonId: entry.seasonId,
            authoritativeSeasonSlug: entry.slug,
            seasonResolutionSource: entry.source,
            previousDatabaseSeasonId: previous?.id ?? null,
            previousDatabaseSeasonSlug: previous?.slug ?? null,
            resultingDatabaseSeasonId: season.id,
            resultingDatabaseSeasonSlug: season.slug,
            battleNetAccountId: account.id,
          },
          "discover_season_authority",
        );

        return entry;
      })().finally(() => {
        regionalSeasonInflight.delete(key);
      });

      regionalSeasonInflight.set(key, pending);
      return pending;
    };

    const ownerships = await prisma.verifiedCharacterOwnership.findMany({
      where: { battleNetAccountId: account.id, status: "CURRENT" },
      include: { region: true },
    });
    counters.ownershipCount = ownerships.length;

    const maxLevel = ownerships.filter(
      (o) => (o.characterLevel ?? 0) >= policy.maxCharacterLevel,
    );
    counters.maxLevelCount = maxLevel.length;

    // Cheap path: below max level — no Mythic+ rating request.
    for (const ownership of ownerships) {
      if ((ownership.characterLevel ?? 0) >= policy.maxCharacterLevel) continue;
      const evaluation = evaluateOwnedCharacterRelevanceV1({
        ownershipStatus: ownership.status,
        characterLevel: ownership.characterLevel,
        currentSeasonMythicRating: null,
        hasValidPublicScore: false,
        hasActiveOrQueuedRefresh: false,
        isPrimary: ownership.isPrimary,
      });
      await prisma.verifiedCharacterOwnership.update({
        where: { id: ownership.id },
        data: {
          relevancePolicyVersion: evaluation.policyVersion,
          relevanceEligible: evaluation.eligible,
          relevanceReasons: evaluation.reasons,
          relevanceEvaluatedAt: new Date(),
        },
      });
      if (evaluation.eligible) counters.relevantCount += 1;
      else counters.irrelevantCount += 1;
    }

    const ratingOutcomes = await mapWithConcurrency(maxLevel, RATING_CONCURRENCY, async (ownership) => {
      const priorFetchedAt = ownership.currentSeasonMythicFetchedAt;
      const priorFreshEnough =
        priorFetchedAt != null &&
        Date.now() - priorFetchedAt.getTime() <= RATING_STALE_RETENTION_MS &&
        ownership.currentSeasonMythicRating != null;

      const regionCode = ownership.region.code;
      let regional: RegionalSeasonCache;
      try {
        regional = await resolveRegionalSeason(
          regionCode,
          ownership.region.id,
          `discover-season-${regionCode}-${account.id}`,
        );
      } catch (error) {
        logger.warn(
          { err: error, ownershipId: ownership.id, region: regionCode },
          "discover-owned-characters regional season resolve failed",
        );
        return {
          ownershipId: ownership.id,
          rating: priorFreshEnough ? ownership.currentSeasonMythicRating : null,
          state: priorFreshEnough ? ("STALE" as const) : ("ERROR" as const),
          source: priorFreshEnough
            ? ownership.currentSeasonMythicSource
            : "blizzard.season.index",
          seasonId: priorFreshEnough
            ? ownership.currentSeasonMythicSeasonId
            : (job.seasonKey ?? null),
          seasonRowId: null as string | null,
          fetchedAt: priorFreshEnough ? priorFetchedAt : new Date(),
          retainedPriorEligible: priorFreshEnough && ownership.relevanceEligible === true,
          priorReasons: asReasonArray(ownership.relevanceReasons),
          providerRequest: true,
          ratingChecked: true,
          failed: true,
          characterProfileSeasonIds: [] as number[],
          characterProfileContainsCurrentSeason: false,
        };
      }

      try {
        const ctx = {
          region: regionCode.toLowerCase() as RegionCode,
          requestId: `discover-${ownership.id}`,
          correlationId: job.correlationId ?? null,
          forceRefresh: false,
          now: new Date().toISOString(),
        };
        const result = await providers.blizzard.getMythicKeystoneProfile(
          {
            region: regionCode.toLowerCase() as RegionCode,
            realmSlug: ownership.realmSlug,
            name: ownership.characterName,
          },
          ctx,
        );
        const profileSeasonIds = result.data.seasons.map((s) => s.seasonId);
        return {
          ownershipId: ownership.id,
          rating: result.data.currentMythicRating,
          state: result.data.currentMythicRating == null ? ("UNAVAILABLE" as const) : ("OK" as const),
          source: "blizzard.character.mplus.index",
          seasonId: regional.slug,
          seasonRowId: regional.season.id,
          fetchedAt: new Date(),
          retainedPriorEligible: false,
          priorReasons: asReasonArray(ownership.relevanceReasons),
          providerRequest: true,
          ratingChecked: true,
          failed: false,
          characterProfileSeasonIds: profileSeasonIds,
          characterProfileContainsCurrentSeason: profileSeasonIds.includes(regional.seasonId),
        };
      } catch (error) {
        logger.warn(
          { err: error, ownershipId: ownership.id },
          "discover-owned-characters rating fetch failed",
        );
        if (priorFreshEnough) {
          return {
            ownershipId: ownership.id,
            rating: ownership.currentSeasonMythicRating,
            state: "STALE" as const,
            source: ownership.currentSeasonMythicSource,
            seasonId: ownership.currentSeasonMythicSeasonId ?? regional.slug,
            seasonRowId: regional.season.id,
            fetchedAt: priorFetchedAt,
            retainedPriorEligible: ownership.relevanceEligible === true,
            priorReasons: asReasonArray(ownership.relevanceReasons),
            providerRequest: true,
            ratingChecked: true,
            failed: true,
            characterProfileSeasonIds: [] as number[],
            characterProfileContainsCurrentSeason: false,
          };
        }
        return {
          ownershipId: ownership.id,
          rating: null,
          state: "ERROR" as const,
          source: "blizzard.character.mplus.index",
          seasonId: regional.slug,
          seasonRowId: regional.season.id,
          fetchedAt: new Date(),
          retainedPriorEligible: false,
          priorReasons: [] as RelevanceReason[],
          providerRequest: true,
          ratingChecked: true,
          failed: true,
          characterProfileSeasonIds: [] as number[],
          characterProfileContainsCurrentSeason: false,
        };
      }
    });

    for (const outcome of ratingOutcomes) {
      if (outcome.providerRequest) counters.providerRequestCount += 1;
      if (outcome.ratingChecked) counters.ratingCheckedCount += 1;
      if (outcome.failed) counters.failedCount += 1;
    }
    const ratingById = new Map(ratingOutcomes.map((r) => [r.ownershipId, r]));

    type RefreshCandidate = {
      ownership: (typeof maxLevel)[number];
      rating: number | null;
      isPrimary: boolean;
      hasFreshScore: boolean;
      hasActiveJob: boolean;
      autoRefreshEligible: boolean;
      seasonRowId: string | null;
    };
    const refreshCandidates: RefreshCandidate[] = [];

    for (const ownership of maxLevel) {
      const ratingInfo = ratingById.get(ownership.id)!;

      await prisma.verifiedCharacterOwnership.update({
        where: { id: ownership.id },
        data: {
          currentSeasonMythicRating: ratingInfo.rating,
          currentSeasonMythicSeasonId: ratingInfo.seasonId,
          currentSeasonMythicFetchedAt: ratingInfo.fetchedAt,
          currentSeasonMythicSource: ratingInfo.source,
          currentSeasonMythicState: ratingInfo.state,
        },
      });

      let hasPublicScore = false;
      let hasFreshScore = false;
      let hasActiveJob = false;
      const seasonRowId = ratingInfo.seasonRowId;

      if (ownership.characterId && seasonRowId && scoreModel) {
        const published = await prisma.characterPublishedScore.findFirst({
          where: {
            characterId: ownership.characterId,
            seasonId: seasonRowId,
            scoreModelId: scoreModel.id,
            scopeType: "CHARACTER",
          },
          include: { publishedSnapshot: true },
        });
        if (published?.publishedSnapshot?.isPublic) {
          hasPublicScore = true;
          const snap = published.publishedSnapshot;
          if (isDatasetFresh(snap.calculatedAt, "calculated.score_snapshot", freshness)) {
            hasFreshScore = true;
            counters.existingFreshScoreCount += 1;
          }
        }

        const activeJob = await prisma.ingestionJob.findFirst({
          where: {
            characterId: ownership.characterId,
            jobType: QUEUE_NAMES.refreshCharacter,
            status: { in: ["QUEUED", "ACTIVE"] },
          },
        });
        hasActiveJob = Boolean(activeJob);
      }

      const evaluation = evaluateOwnedCharacterRelevanceV1({
        ownershipStatus: ownership.status,
        characterLevel: ownership.characterLevel,
        currentSeasonMythicRating: ratingInfo.rating,
        hasValidPublicScore: hasPublicScore,
        hasActiveOrQueuedRefresh: hasActiveJob,
        isPrimary: ownership.isPrimary,
      });

      // Retain prior display-eligible when rating fetch failed but prior result was fresh enough.
      const eligible =
        evaluation.eligible ||
        (ratingInfo.retainedPriorEligible && ratingInfo.state === "STALE");
      const reasons = eligible && !evaluation.eligible ? ratingInfo.priorReasons : evaluation.reasons;

      await prisma.verifiedCharacterOwnership.update({
        where: { id: ownership.id },
        data: {
          relevancePolicyVersion: policy.version,
          relevanceEligible: eligible,
          relevanceReasons: reasons,
          relevanceEvaluatedAt: new Date(),
        },
      });

      if (eligible) counters.relevantCount += 1;
      else counters.irrelevantCount += 1;

      const autoRefresh = evaluateOwnedCharacterAutoRefreshEligibilityV1({
        ownershipStatus: ownership.status,
        characterLevel: ownership.characterLevel,
        currentSeasonMythicRating: ratingInfo.rating,
      });
      if (autoRefresh.eligible) counters.autoRefreshEligibleCount += 1;

      logger.info(
        {
          triggerSource: "ACCOUNT_DISCOVERY",
          ownershipId: ownership.id,
          region: ownership.region.code,
          authoritativeSeasonSlug: ratingInfo.seasonId,
          characterProfileSeasonIds: ratingInfo.characterProfileSeasonIds,
          characterProfileContainsCurrentSeason: ratingInfo.characterProfileContainsCurrentSeason,
          displayRelevant: eligible,
          autoRefreshEligible: autoRefresh.eligible,
          autoRefreshReasons: autoRefresh.reasons,
        },
        "discover_character_eligibility",
      );

      if (autoRefresh.eligible) {
        refreshCandidates.push({
          ownership,
          rating: ratingInfo.rating,
          isPrimary: ownership.isPrimary,
          hasFreshScore,
          hasActiveJob,
          autoRefreshEligible: true,
          seasonRowId,
        });
      }
    }

    // Priority: primary → highest rating → remainder (among auto-refresh-eligible only)
    refreshCandidates.sort((a, b) => {
      if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
      return (b.rating ?? -1) - (a.rating ?? -1);
    });

    for (const candidate of refreshCandidates) {
      try {
        const classSlug = slugFromBlizzardPlayableClassId(candidate.ownership.playableClassId);
        const character = await repositories.character.upsertCharacter(
          {
            region: candidate.ownership.region.code.toLowerCase() as RegionCode,
            realmSlug: candidate.ownership.realmSlug,
            name: candidate.ownership.characterName,
          },
          {
            displayName: candidate.ownership.characterName,
            classSlug,
            blizzardCharacterId: candidate.ownership.blizzardCharacterId.toString(),
          },
        );

        if (candidate.ownership.characterId !== character.id) {
          await prisma.verifiedCharacterOwnership.update({
            where: { id: candidate.ownership.id },
            data: { characterId: character.id },
          });
        }

        if (candidate.hasFreshScore) {
          continue;
        }

        const activeJob = await prisma.ingestionJob.findFirst({
          where: {
            characterId: character.id,
            jobType: QUEUE_NAMES.refreshCharacter,
            status: { in: ["QUEUED", "ACTIVE"] },
          },
        });
        if (activeJob || candidate.hasActiveJob) {
          counters.alreadyQueuedCount += 1;
          logger.info(
            {
              triggerSource: "ACCOUNT_DISCOVERY",
              characterId: character.id,
              refresh: "reused",
            },
            "discover_refresh_enqueue",
          );
          continue;
        }

        const priority = candidate.isPrimary
          ? "high"
          : (candidate.rating ?? 0) >= 2500
            ? "normal"
            : "low";

        const enqueued = await producers.enqueueRefreshCharacter({
          characterId: character.id,
          region: candidate.ownership.region.code.toLowerCase() as RegionCode,
          realmSlug: candidate.ownership.realmSlug,
          name: candidate.ownership.characterName,
          priority,
          forceRefresh: false,
          correlationId: job.correlationId ?? null,
          triggerSource: "ACCOUNT_DISCOVERY",
        });

        if (enqueued.reused && !enqueued.enqueued) {
          counters.alreadyQueuedCount += 1;
          logger.info(
            {
              triggerSource: "ACCOUNT_DISCOVERY",
              characterId: character.id,
              refresh: "reused",
            },
            "discover_refresh_enqueue",
          );
        } else {
          counters.refreshQueuedCount += 1;
          logger.info(
            {
              triggerSource: "ACCOUNT_DISCOVERY",
              characterId: character.id,
              refresh: "enqueued",
            },
            "discover_refresh_enqueue",
          );
        }
      } catch (error) {
        counters.failedCount += 1;
        logger.warn(
          { err: error, ownershipId: candidate.ownership.id },
          "discover-owned-characters character link/refresh failed",
        );
      }
    }

    await prisma.battleNetAccount.update({
      where: { id: account.id },
      data: {
        lastDiscoveryStatus: "COMPLETED",
        lastDiscoveryFinishedAt: new Date(),
        lastDiscoveryCounters: counters as unknown as Prisma.InputJsonValue,
        lastDiscoveryError: null,
      },
    });

    logger.info(
      { battleNetAccountId: account.id, counters },
      "discover-owned-characters completed",
    );
    return { counters };
  } catch (error) {
    const message = error instanceof Error ? error.message : "discovery failed";
    await prisma.battleNetAccount.update({
      where: { id: account.id },
      data: {
        lastDiscoveryStatus: "FAILED",
        lastDiscoveryFinishedAt: new Date(),
        lastDiscoveryError: message,
        lastDiscoveryCounters: counters as unknown as Prisma.InputJsonValue,
      },
    });
    throw error;
  }
}
