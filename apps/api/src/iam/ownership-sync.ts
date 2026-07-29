import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@mplus/database";
import { normalizeName, normalizeRealmSlug } from "@mplus/domain";
import type { WowAccountCharacter, WowUserProfile } from "./battlenet-oauth-client.js";

export interface OwnershipSyncResult {
  currentCount: number;
  historicalCount: number;
  primaryCharacterId: string | null;
}

function collectCharacters(profile: WowUserProfile): WowAccountCharacter[] {
  const out: WowAccountCharacter[] = [];
  for (const account of profile.wow_accounts ?? []) {
    for (const character of account.characters ?? []) {
      if (typeof character.id === "number" && character.name && character.realm?.slug) {
        out.push(character);
      }
    }
  }
  return out;
}

/**
 * Upsert CURRENT ownership from provider payload; mark missing prior CURRENT rows HISTORICAL.
 * Never invents ownership without provider-backed character ids.
 */
export async function syncVerifiedOwnership(input: {
  prisma: PrismaClient;
  userId: string;
  battleNetAccountId: string;
  regionCode: string;
  profile: WowUserProfile;
  source?: string;
}): Promise<OwnershipSyncResult> {
  const region = await input.prisma.region.findUnique({ where: { code: input.regionCode.toUpperCase() } });
  if (!region) {
    throw new Error(`Unknown region for ownership sync: ${input.regionCode}`);
  }

  const now = new Date();
  const providerChars = collectCharacters(input.profile);
  const seenIds = new Set<bigint>();
  let primaryCharacterId: string | null = null;

  for (const character of providerChars) {
    const blizzardCharacterId = BigInt(character.id);
    seenIds.add(blizzardCharacterId);
    const realmSlug = normalizeRealmSlug(character.realm!.slug!);
    const displayName = character.name;
    const normalizedName = normalizeName(displayName);

    const localCharacter = await input.prisma.character.findFirst({
      where: {
        OR: [
          { blizzardCharacterId },
          {
            regionId: region.id,
            realm: { slug: realmSlug },
            normalizedName,
          },
        ],
      },
      include: { realm: true },
    });

    if (localCharacter && !localCharacter.blizzardCharacterId) {
      await input.prisma.character.update({
        where: { id: localCharacter.id },
        data: { blizzardCharacterId },
      });
    }

    const ownership = await input.prisma.verifiedCharacterOwnership.upsert({
      where: {
        battleNetAccountId_blizzardCharacterId: {
          battleNetAccountId: input.battleNetAccountId,
          blizzardCharacterId,
        },
      },
      create: {
        id: randomUUID(),
        battleNetAccountId: input.battleNetAccountId,
        userId: input.userId,
        characterId: localCharacter?.id ?? null,
        blizzardCharacterId,
        regionId: region.id,
        realmSlug,
        realmName: character.realm?.name ?? null,
        characterName: displayName,
        normalizedName,
        playableClassId: character.playable_class?.id ?? null,
        playableRaceId: character.playable_race?.id ?? null,
        characterLevel: character.level ?? null,
        faction: character.faction?.type ?? character.faction?.name ?? null,
        confidence: "CONFIRMED",
        source: input.source ?? "blizzard.profile.user.wow",
        status: "CURRENT",
        verifiedAt: now,
        lastSeenAt: now,
      },
      update: {
        characterId: localCharacter?.id ?? undefined,
        regionId: region.id,
        realmSlug,
        realmName: character.realm?.name ?? null,
        characterName: displayName,
        normalizedName,
        playableClassId: character.playable_class?.id ?? null,
        playableRaceId: character.playable_race?.id ?? null,
        characterLevel: character.level ?? null,
        faction: character.faction?.type ?? character.faction?.name ?? null,
        status: "CURRENT",
        revokedAt: null,
        lastSeenAt: now,
        verifiedAt: now,
        source: input.source ?? "blizzard.profile.user.wow",
      },
    });

    if (ownership.isPrimary) {
      primaryCharacterId = ownership.id;
    }
  }

  const stale = await input.prisma.verifiedCharacterOwnership.findMany({
    where: {
      battleNetAccountId: input.battleNetAccountId,
      status: "CURRENT",
      blizzardCharacterId: { notIn: [...seenIds] },
    },
  });

  if (stale.length > 0) {
    await input.prisma.verifiedCharacterOwnership.updateMany({
      where: { id: { in: stale.map((row) => row.id) } },
      data: { status: "HISTORICAL", lastSeenAt: now },
    });
  }

  const currentCount = await input.prisma.verifiedCharacterOwnership.count({
    where: { battleNetAccountId: input.battleNetAccountId, status: "CURRENT" },
  });
  const historicalCount = await input.prisma.verifiedCharacterOwnership.count({
    where: { battleNetAccountId: input.battleNetAccountId, status: "HISTORICAL" },
  });

  return { currentCount, historicalCount, primaryCharacterId };
}
