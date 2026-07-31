import { presentWowClass } from "@mplus/config";
import type { AppEnv } from "@mplus/config";
import {
  ACTIVE_REROLLS_MAX,
  toActiveRerollGrade,
  type ActiveRerollCharacterDTO,
  type ActiveRerollsResponse,
} from "@mplus/contracts";
import type { PrismaClient } from "@mplus/database";
import { normalizeName, normalizeRealmSlug, normalizeRegion } from "@mplus/domain";
import type { Logger } from "@mplus/observability";

function readAvatarFromSnapshot(rawSummary: unknown): string | null {
  if (!rawSummary || typeof rawSummary !== "object") return null;
  const media = (rawSummary as { media?: { avatarUrl?: unknown } }).media;
  const avatar = media?.avatarUrl;
  return typeof avatar === "string" && avatar.startsWith("https://") ? avatar : null;
}

const emptyResponse = (): ActiveRerollsResponse => ({
  displayedCharacterIsMain: false,
  rerolls: [],
});

/** Shared ownership predicates for displayed character + reroll rows. */
export const ACTIVE_REROLL_OWNERSHIP_FILTER = {
  status: "CURRENT" as const,
  revokedAt: null,
  confidence: "CONFIRMED" as const,
  characterId: { not: null },
};

export const ACTIVE_REROLL_ACCOUNT_FILTER = {
  unlinkedAt: null,
  claimed: true,
};

/**
 * Schema only uniquely constrains (battleNetAccountId, blizzardCharacterId).
 * A Character can have multiple CURRENT+CONFIRMED ownerships across accounts.
 * Probe with take=2 to detect ambiguity without scanning the full table.
 */
export const DISPLAYED_OWNERSHIP_AMBIGUITY_PROBE = 2;

type OwnershipRow = {
  id: string;
  battleNetAccountId: string;
  characterId: string | null;
  regionId: string;
  realmSlug: string;
  realmName: string | null;
  characterName: string;
  normalizedName: string;
  playableClassId: number | null;
  isPrimary: boolean;
  verifiedAt: Date;
  relevanceEligible: boolean | null;
  currentSeasonMythicRating: number | null;
  region: { code: string };
  character: {
    id: string;
    gameClass: { slug: string } | null;
    snapshots: Array<{ rawSummary: unknown }>;
    publishedScores: Array<{
      seasonId: string;
      scoreModelId: string;
      scopeType: string;
      publishedSnapshot: { isPublic: boolean; grade: string } | null;
    }>;
  } | null;
};

/**
 * Deterministic primary resolution when multiple CURRENT rows are marked primary.
 * Prefer the displayed ownership when it is primary; otherwise most recently verified.
 */
export function resolveAccountPrimaryOwnershipId(
  ownerships: Array<{ id: string; isPrimary: boolean; verifiedAt: Date }>,
  displayedOwnershipId: string,
  log?: Logger | null,
): string | null {
  const primaries = ownerships.filter((o) => o.isPrimary);
  if (primaries.length === 0) return null;
  if (primaries.length === 1) return primaries[0]!.id;

  const displayedPrimary = primaries.find((o) => o.id === displayedOwnershipId);
  const chosen =
    displayedPrimary ??
    [...primaries].sort((a, b) => b.verifiedAt.getTime() - a.verifiedAt.getTime())[0]!;

  log?.warn(
    {
      event: "active_rerolls.multiple_primary",
      battleNetAccountOwnershipCount: ownerships.length,
      primaryCount: primaries.length,
      chosenOwnershipIdHash: chosen.id.slice(0, 8),
      preferredDisplayed: Boolean(displayedPrimary),
    },
    "Multiple CURRENT primary ownerships on one Battle.net account; resolved deterministically",
  );

  return chosen.id;
}

function compareRerolls(a: ActiveRerollCharacterDTO, b: ActiveRerollCharacterDTO): number {
  const scoreA = a.mythicPlusScore ?? Number.NEGATIVE_INFINITY;
  const scoreB = b.mythicPlusScore ?? Number.NEGATIVE_INFINITY;
  if (scoreA !== scoreB) return scoreB - scoreA;
  const regionCmp = a.region.localeCompare(b.region);
  if (regionCmp !== 0) return regionCmp;
  const realmCmp = a.realmSlug.localeCompare(b.realmSlug);
  if (realmCmp !== 0) return realmCmp;
  const nameCmp = a.name.localeCompare(b.name);
  if (nameCmp !== 0) return nameCmp;
  return a.characterId.localeCompare(b.characterId);
}

/**
 * Active Rerolls for a displayed character profile.
 *
 * Auth-required, not owner-only. Reuses Account relevance policy
 * (relevanceEligible || isPrimary). Bounded, batched, read-only — no provider calls.
 *
 * Query shape (bounded, no N+1 per reroll):
 * 1. region by code
 * 2. character by region+realm+normalizedName
 * 3. displayed ownership probe (take 2) — fail closed on ambiguity
 * 4. one findMany of same-account ownerships (relevanceEligible || isPrimary)
 * 5. one active score model
 * 6. one seasons findMany for distinct regionIds (isCurrent)
 */
export async function buildActiveRerollsView(input: {
  prisma: PrismaClient;
  env: AppEnv;
  region: string;
  realmSlug: string;
  name: string;
  logger?: Logger | null;
}): Promise<ActiveRerollsResponse> {
  const { prisma, env, logger } = input;
  const regionCode = normalizeRegion(input.region);
  const realmSlug = normalizeRealmSlug(input.realmSlug);
  const normalizedName = normalizeName(input.name);

  const region = await prisma.region.findFirst({
    where: { code: regionCode },
    select: { id: true },
  });
  if (!region) return emptyResponse();

  const character = await prisma.character.findFirst({
    where: {
      regionId: region.id,
      realm: { slug: realmSlug },
      normalizedName,
    },
    select: { id: true },
  });
  if (!character) return emptyResponse();

  // No unique constraint on characterId for CURRENT+CONFIRMED+claimed ownerships.
  // Probe two rows deterministically; refuse to pick an account when ambiguous.
  const displayedCandidates = await prisma.verifiedCharacterOwnership.findMany({
    where: {
      ...ACTIVE_REROLL_OWNERSHIP_FILTER,
      characterId: character.id,
      battleNetAccount: ACTIVE_REROLL_ACCOUNT_FILTER,
    },
    select: {
      id: true,
      battleNetAccountId: true,
      characterId: true,
      isPrimary: true,
      verifiedAt: true,
    },
    orderBy: [{ verifiedAt: "desc" }, { id: "asc" }],
    take: DISPLAYED_OWNERSHIP_AMBIGUITY_PROBE,
  });

  if (displayedCandidates.length === 0) {
    return emptyResponse();
  }

  if (displayedCandidates.length > 1) {
    const accountIds = [...new Set(displayedCandidates.map((c) => c.battleNetAccountId))];
    logger?.warn(
      {
        event: "active_rerolls.ambiguous_displayed_ownership",
        characterIdHash: character.id.slice(0, 8),
        qualifyingOwnershipProbeCount: displayedCandidates.length,
        distinctBattleNetAccountProbeCount: accountIds.length,
      },
      "Ambiguous CURRENT ownership for displayed character; returning empty Active Rerolls",
    );
    return emptyResponse();
  }

  const displayedOwnership = displayedCandidates[0]!;
  if (!displayedOwnership.characterId) {
    return emptyResponse();
  }

  const ownerships = (await prisma.verifiedCharacterOwnership.findMany({
    where: {
      battleNetAccountId: displayedOwnership.battleNetAccountId,
      ...ACTIVE_REROLL_OWNERSHIP_FILTER,
      battleNetAccount: ACTIVE_REROLL_ACCOUNT_FILTER,
      OR: [{ relevanceEligible: true }, { isPrimary: true }],
    },
    include: {
      region: { select: { code: true } },
      character: {
        select: {
          id: true,
          gameClass: { select: { slug: true } },
          snapshots: {
            orderBy: { capturedAt: "desc" },
            take: 1,
            select: { rawSummary: true },
          },
          publishedScores: {
            select: {
              seasonId: true,
              scoreModelId: true,
              scopeType: true,
              publishedSnapshot: { select: { isPublic: true, grade: true } },
            },
          },
        },
      },
    },
  })) as OwnershipRow[];

  const primaryOwnershipId = resolveAccountPrimaryOwnershipId(
    ownerships.map((o) => ({
      id: o.id,
      isPrimary: o.isPrimary,
      verifiedAt: o.verifiedAt,
    })),
    displayedOwnership.id,
    logger,
  );

  const displayedCharacterIsMain = primaryOwnershipId === displayedOwnership.id;

  const scoreModel = await prisma.scoreModel.findFirst({
    where: { status: "ACTIVE" },
    orderBy: [{ key: "asc" }, { version: "desc" }],
    select: { id: true },
  });

  const regionIds = [...new Set(ownerships.map((o) => o.regionId))];
  const seasons =
    regionIds.length === 0
      ? []
      : await prisma.season.findMany({
          where: { regionId: { in: regionIds }, isCurrent: true },
          select: { id: true, regionId: true },
        });
  const currentSeasonIdByRegionId = new Map(seasons.map((s) => [s.regionId, s.id]));

  const rerolls: ActiveRerollCharacterDTO[] = [];

  for (const row of ownerships) {
    if (row.id === displayedOwnership.id) continue;
    if (!row.characterId || !row.character) continue;

    const classPresentation = presentWowClass({
      playableClassId: row.playableClassId,
      classSlug: row.character.gameClass?.slug ?? null,
    });

    const portraitFromSnapshot = readAvatarFromSnapshot(row.character.snapshots[0]?.rawSummary);

    let grade: ActiveRerollCharacterDTO["grade"] = null;
    if (scoreModel) {
      const seasonId = currentSeasonIdByRegionId.get(row.regionId);
      const published = row.character.publishedScores.find(
        (p) =>
          p.seasonId === seasonId &&
          p.scoreModelId === scoreModel.id &&
          p.scopeType === "CHARACTER",
      );
      const snap = published?.publishedSnapshot;
      if (snap?.isPublic) {
        grade = toActiveRerollGrade(snap.grade);
      }
    }

    rerolls.push({
      characterId: row.characterId,
      region: row.region.code,
      realmSlug: row.realmSlug,
      realmName: row.realmName,
      name: row.characterName,
      classSlug: classPresentation.slug,
      className: classPresentation.name,
      classColor: classPresentation.color,
      portraitUrl: portraitFromSnapshot,
      mythicPlusScore:
        row.currentSeasonMythicRating != null && Number.isFinite(row.currentSeasonMythicRating)
          ? row.currentSeasonMythicRating
          : null,
      grade,
      isMain: primaryOwnershipId === row.id,
    });
  }

  rerolls.sort(compareRerolls);

  return {
    displayedCharacterIsMain,
    rerolls: rerolls.slice(0, ACTIVE_REROLLS_MAX),
  };
}
