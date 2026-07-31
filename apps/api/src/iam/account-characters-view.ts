import {
  buildFreshnessConfig,
  decideScoreRefresh,
  extractJobErrorCode,
  isDatasetFresh,
  presentWowClass,
  toAccountTrustStatus,
} from "@mplus/config";
import type {
  AccountCharactersResponse,
  AccountOwnedCharacterDTO,
  AccountTrustScoreStatus,
} from "@mplus/contracts";
import type { AppEnv } from "@mplus/config";
import type { PrismaClient } from "@mplus/database";
import { QUEUE_NAMES } from "@mplus/contracts";
import { toPublicRefreshErrorMessage } from "../lib/public-error-sanitize.js";

function readAvatarFromSnapshot(rawSummary: unknown): string | null {
  if (!rawSummary || typeof rawSummary !== "object") return null;
  const media = (rawSummary as { media?: { avatarUrl?: unknown } }).media;
  const avatar = media?.avatarUrl;
  return typeof avatar === "string" && avatar.startsWith("https://") ? avatar : null;
}

/**
 * Server-side account character view: ownership + character + score + job + class/media.
 * Default list is relevant CURRENT only.
 * Completed scores stay visible during refresh (REFRESHING); never flip to loading-only.
 * Failed background refreshes never replace a usable published grade with public FAILED.
 */
export async function buildAccountCharactersView(input: {
  prisma: PrismaClient;
  env: AppEnv;
  userId: string;
  /** When true, return all CURRENT ownerships (debug). */
  includeIrrelevant?: boolean;
}): Promise<AccountCharactersResponse> {
  const { prisma, env, userId } = input;
  const freshness = buildFreshnessConfig(env);

  const account = await prisma.battleNetAccount.findFirst({
    where: { userId, unlinkedAt: null },
    orderBy: { linkedAt: "desc" },
  });

  const totalOwnedCharacterCount = await prisma.verifiedCharacterOwnership.count({
    where: { userId, status: "CURRENT" },
  });

  const discovery = {
    status: mapDiscoveryStatus(account?.lastDiscoveryStatus),
    jobId: account?.lastDiscoveryJobId ?? null,
    startedAt: account?.lastDiscoveryStartedAt?.toISOString() ?? null,
    finishedAt: account?.lastDiscoveryFinishedAt?.toISOString() ?? null,
    error: account?.lastDiscoveryError ?? null,
  } as const;

  const ownerships = await prisma.verifiedCharacterOwnership.findMany({
    where: {
      userId,
      status: "CURRENT",
      ...(input.includeIrrelevant
        ? {}
        : {
            OR: [{ relevanceEligible: true }, { isPrimary: true }],
          }),
    },
    include: {
      region: true,
      character: {
        include: {
          gameClass: true,
          snapshots: { orderBy: { capturedAt: "desc" }, take: 1 },
          publishedScores: {
            include: {
              publishedSnapshot: { include: { scoreModel: true } },
              season: true,
            },
          },
        },
      },
    },
  });

  const scoreModel = await prisma.scoreModel.findFirst({
    where: { status: "ACTIVE" },
    orderBy: [{ key: "asc" }, { version: "desc" }],
  });

  /** Region-scoped current seasons only — never invent via provider calls. */
  const currentSeasonByRegionId = new Map<string, { id: string; slug: string }>();
  const resolveCurrentSeasonForRegion = async (regionId: string) => {
    const cached = currentSeasonByRegionId.get(regionId);
    if (cached) return cached;
    const season = await prisma.season.findFirst({
      where: { regionId, isCurrent: true },
      select: { id: true, slug: true },
    });
    if (season) currentSeasonByRegionId.set(regionId, season);
    return season;
  };

  const characters: AccountOwnedCharacterDTO[] = [];

  for (const row of ownerships) {
    const classPresentation = presentWowClass({
      playableClassId: row.playableClassId,
      classSlug: row.character?.gameClass?.slug ?? null,
    });

    const portraitFromSnapshot = row.character
      ? readAvatarFromSnapshot(row.character.snapshots[0]?.rawSummary)
      : null;

    let trustStatus: AccountTrustScoreStatus = "NOT_REQUESTED";
    let jobId: string | null = null;
    let score: number | null = null;
    let grade: string | null = null;
    let confidence: number | null = null;
    let modelVersion: number | null = null;
    let calculatedAt: string | null = null;
    let errorCode: string | null = null;
    let errorMessage: string | null = null;

    if (row.characterId) {
      const season = await resolveCurrentSeasonForRegion(row.regionId);
      const activeJob = await prisma.ingestionJob.findFirst({
        where: {
          characterId: row.characterId,
          jobType: QUEUE_NAMES.refreshCharacter,
          status: { in: ["QUEUED", "ACTIVE"] },
        },
        orderBy: { scheduledAt: "desc" },
      });
      const latestJob =
        activeJob ??
        (await prisma.ingestionJob.findFirst({
          where: {
            characterId: row.characterId,
            jobType: QUEUE_NAMES.refreshCharacter,
          },
          orderBy: { scheduledAt: "desc" },
        }));
      if (latestJob) {
        jobId = latestJob.id;
      }

      const published = row.character?.publishedScores.find(
        (p: { seasonId: string; scoreModelId: string; scopeType: string }) =>
          p.seasonId === season?.id &&
          p.scoreModelId === scoreModel?.id &&
          p.scopeType === "CHARACTER",
      );
      const snap = published?.publishedSnapshot;
      const hasPublished = Boolean(snap?.isPublic);

      if (hasPublished && snap) {
        score = Number(snap.overallScore);
        grade = snap.grade;
        confidence = Number(snap.confidence);
        modelVersion = snap.scoreModel?.version ?? env.ACTIVE_SCORE_MODEL_VERSION;
        calculatedAt = snap.calculatedAt.toISOString();
      }

      const decision = decideScoreRefresh({
        hasPublishedScore: hasPublished,
        scoreCalculatedAt: snap?.calculatedAt ?? null,
        gradeIsU: snap?.grade === "U",
        scoreTtlSeconds: env.SCORE_TTL_SECONDS,
        failureBackoffSeconds: env.REFRESH_FAILURE_BACKOFF_SECONDS,
        activeJobStatus: activeJob ? (activeJob.status as "QUEUED" | "ACTIVE") : null,
        latestJobStatus: latestJob?.status ?? null,
        latestJobFinishedAt: latestJob?.completedAt ?? null,
        latestJobErrorCode: extractJobErrorCode(latestJob?.error),
        contractReasons: [],
      });

      // Account navigation is read-only — never enqueue from this view.
      // Completed jobs must not flip a usable score back to loading.
      if (hasPublished) {
        const fresh = isDatasetFresh(snap!.calculatedAt, "calculated.score_snapshot", freshness);
        trustStatus = toAccountTrustStatus(decision, {
          partial: snap!.coverageState === "PARTIAL",
        }) as AccountTrustScoreStatus;
        if (snap!.rejectionReason && decision.action === "NONE" && fresh) {
          trustStatus = "UNAVAILABLE";
          errorCode = "UNAVAILABLE";
          errorMessage = "Trust Score is temporarily unavailable.";
        }
        if (decision.reason === "RECENT_FAILURE") {
          const safe = toPublicRefreshErrorMessage(latestJob?.error, {
            hasPublishedScore: true,
          });
          errorCode = safe.errorCode;
          errorMessage = safe.errorMessage;
        }
      } else if (decision.publicState === "UNAVAILABLE") {
        trustStatus = "FAILED";
        const safe = toPublicRefreshErrorMessage(latestJob?.error, {
          hasPublishedScore: false,
        });
        errorCode = safe.errorCode;
        errorMessage = safe.errorMessage;
      } else if (decision.detailedRefreshStatus === "FAILED" && !hasPublished) {
        trustStatus = "FAILED";
        const safe = toPublicRefreshErrorMessage(latestJob?.error, {
          hasPublishedScore: false,
        });
        errorCode = safe.errorCode;
        errorMessage = safe.errorMessage;
      } else if (
        decision.publicState === "CALCULATING" ||
        decision.publicState === "NO_SCORE_QUEUED"
      ) {
        trustStatus = toAccountTrustStatus(decision, {
          discovering: discovery.status === "QUEUED" || discovery.status === "RUNNING",
        }) as AccountTrustScoreStatus;
      } else if (discovery.status === "QUEUED" || discovery.status === "RUNNING") {
        trustStatus = "DISCOVERING";
      }
    } else if (discovery.status === "QUEUED" || discovery.status === "RUNNING") {
      trustStatus = "DISCOVERING";
    }

    characters.push({
      ownershipId: row.id,
      characterId: row.characterId,
      region: row.region.code,
      realmSlug: row.realmSlug,
      realmName: row.realmName,
      name: row.characterName,
      level: row.characterLevel,
      isPrimary: row.isPrimary,
      characterClass: {
        id: classPresentation.id,
        slug: classPresentation.slug,
        name: classPresentation.name,
        color: classPresentation.color,
      },
      media: {
        portraitUrl: portraitFromSnapshot,
      },
      currentSeasonMythic: {
        rating: row.currentSeasonMythicRating,
        seasonId: row.currentSeasonMythicSeasonId,
        fetchedAt: row.currentSeasonMythicFetchedAt?.toISOString() ?? null,
        source: row.currentSeasonMythicSource,
        state:
          (row.currentSeasonMythicState as AccountOwnedCharacterDTO["currentSeasonMythic"]["state"]) ??
          null,
      },
      trustScore: {
        status: trustStatus,
        jobId,
        score,
        grade,
        confidence,
        modelVersion,
        calculatedAt,
        errorCode,
        errorMessage,
      },
      relevance: {
        policyVersion: row.relevancePolicyVersion ?? "v1",
        eligible: row.relevanceEligible ?? false,
        reasons: Array.isArray(row.relevanceReasons) ? (row.relevanceReasons as string[]) : [],
        evaluatedAt: row.relevanceEvaluatedAt?.toISOString() ?? null,
      },
    });
  }

  characters.sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    const scoreA = a.trustScore.score ?? -1;
    const scoreB = b.trustScore.score ?? -1;
    if (scoreA !== scoreB) return scoreB - scoreA;
    const ratingA = a.currentSeasonMythic.rating ?? -1;
    const ratingB = b.currentSeasonMythic.rating ?? -1;
    if (ratingA !== ratingB) return ratingB - ratingA;
    return a.name.localeCompare(b.name);
  });

  const relevantCount = await prisma.verifiedCharacterOwnership.count({
    where: {
      userId,
      status: "CURRENT",
      OR: [{ relevanceEligible: true }, { isPrimary: true }],
    },
  });
  const hiddenCharacterCount = Math.max(0, totalOwnedCharacterCount - relevantCount);

  const hasCurrentPrimary = characters.some((c) => c.isPrimary);
  const primaryDiagnostic =
    totalOwnedCharacterCount > 0 && !hasCurrentPrimary
      ? "No current primary character is selected among relevant owned characters."
      : null;

  return {
    characters: input.includeIrrelevant
      ? characters
      : characters.filter((c) => c.relevance.eligible || c.isPrimary),
    discovery,
    hiddenCharacterCount,
    totalOwnedCharacterCount,
    primaryDiagnostic,
  };
}

function mapDiscoveryStatus(
  status: string | null | undefined,
): AccountCharactersResponse["discovery"]["status"] {
  if (!status) return "IDLE";
  if (status === "QUEUED") return "QUEUED";
  if (status === "RUNNING") return "RUNNING";
  if (status === "COMPLETED") return "COMPLETED";
  if (status === "FAILED") return "FAILED";
  return "IDLE";
}
