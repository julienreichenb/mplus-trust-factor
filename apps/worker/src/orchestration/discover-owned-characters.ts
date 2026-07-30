import {
  OWNED_CHARACTER_RELEVANCE_POLICY_V1,
  buildFreshnessConfig,
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
import type { Prisma } from "@mplus/database";
import type { WorkerContainer } from "../container.js";
import type { QueueProducers } from "../queues.js";
import { mapWithConcurrency } from "./concurrency.js";

export interface DiscoveryCounters {
  ownershipCount: number;
  maxLevelCount: number;
  ratingCheckedCount: number;
  relevantCount: number;
  irrelevantCount: number;
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

/**
 * Account-character discovery: cheap relevance evaluation → ensure Character rows →
 * enqueue refresh-character for relevant characters. Never calls WCL.
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
    const season = await prisma.season.findFirst({ where: { isCurrent: true } });
    const seasonKey = season?.slug ?? job.seasonKey;
    const scoreModel = await repositories.score.getActiveModel(env.ACTIVE_SCORE_MODEL_KEY);

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

      try {
        const ctx = {
          region: ownership.region.code.toLowerCase() as RegionCode,
          requestId: `discover-${ownership.id}`,
          correlationId: job.correlationId ?? null,
          forceRefresh: false,
          now: new Date().toISOString(),
        };
        const result = await providers.blizzard.getMythicKeystoneProfile(
          {
            region: ownership.region.code.toLowerCase() as RegionCode,
            realmSlug: ownership.realmSlug,
            name: ownership.characterName,
          },
          ctx,
        );
        return {
          ownershipId: ownership.id,
          rating: result.data.currentMythicRating,
          state: result.data.currentMythicRating == null ? ("UNAVAILABLE" as const) : ("OK" as const),
          source: "blizzard.character.mplus.index",
          seasonId: seasonKey,
          fetchedAt: new Date(),
          retainedPriorEligible: false,
          priorReasons: asReasonArray(ownership.relevanceReasons),
          providerRequest: true,
          ratingChecked: true,
          failed: false,
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
            seasonId: ownership.currentSeasonMythicSeasonId,
            fetchedAt: priorFetchedAt,
            retainedPriorEligible: ownership.relevanceEligible === true,
            priorReasons: asReasonArray(ownership.relevanceReasons),
            providerRequest: true,
            ratingChecked: true,
            failed: true,
          };
        }
        return {
          ownershipId: ownership.id,
          rating: null,
          state: "ERROR" as const,
          source: "blizzard.character.mplus.index",
          seasonId: seasonKey,
          fetchedAt: new Date(),
          retainedPriorEligible: false,
          priorReasons: [] as RelevanceReason[],
          providerRequest: true,
          ratingChecked: true,
          failed: true,
        };
      }
    });

    for (const outcome of ratingOutcomes) {
      if (outcome.providerRequest) counters.providerRequestCount += 1;
      if (outcome.ratingChecked) counters.ratingCheckedCount += 1;
      if (outcome.failed) counters.failedCount += 1;
    }
    const ratingById = new Map(ratingOutcomes.map((r) => [r.ownershipId, r]));

    type RelevantCandidate = {
      ownership: (typeof maxLevel)[number];
      rating: number | null;
      isPrimary: boolean;
      hasFreshScore: boolean;
      hasActiveJob: boolean;
    };
    const relevant: RelevantCandidate[] = [];

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

      if (ownership.characterId && season && scoreModel) {
        const published = await prisma.characterPublishedScore.findFirst({
          where: {
            characterId: ownership.characterId,
            seasonId: season.id,
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

      // Retain prior eligible when rating fetch failed but prior result was fresh enough.
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

      if (eligible) {
        counters.relevantCount += 1;
        relevant.push({
          ownership,
          rating: ratingInfo.rating,
          isPrimary: ownership.isPrimary,
          hasFreshScore,
          hasActiveJob,
        });
      } else {
        counters.irrelevantCount += 1;
      }
    }

    // Priority: primary → highest rating → remainder
    relevant.sort((a, b) => {
      if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
      return (b.rating ?? -1) - (a.rating ?? -1);
    });

    for (const candidate of relevant) {
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
        } else {
          counters.refreshQueuedCount += 1;
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
