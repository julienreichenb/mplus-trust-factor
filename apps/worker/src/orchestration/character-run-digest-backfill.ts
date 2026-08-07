/**
 * Associate an existing Character with previously persisted CharacterRunDigest
 * rows that were written for companions without a local Character.
 *
 * Matching uses provider-native identity on the digest (region + realm + name).
 * Digests do not store Blizzard character IDs today — never invent them.
 * Fail closed when region/realm/name are incomplete or ambiguous.
 */
import type { PrismaClient } from "@mplus/database";
import {
  CharacterRunDigestCharacterLinkConflictError,
  CharacterRunDigestRepository,
} from "@mplus/database";
import { normalizeName, normalizeRealmSlug, normalizeRegion } from "@mplus/domain";

export type CharacterRunDigestBackfillResult = {
  characterId: string;
  matched: number;
  linked: number;
  alreadyLinked: number;
  skippedIncompleteIdentity: number;
  skippedConflict: number;
  digestIdsLinked: string[];
};

function emptyResult(characterId: string): CharacterRunDigestBackfillResult {
  return {
    characterId,
    matched: 0,
    linked: 0,
    alreadyLinked: 0,
    skippedIncompleteIdentity: 0,
    skippedConflict: 0,
    digestIdsLinked: [],
  };
}

/**
 * Exact normalized identity match for unlinked digests.
 * Requires non-empty region + realm + name on both Character and digest.
 */
export function digestMatchesCharacterIdentity(input: {
  digest: {
    characterName: string;
    realmSlug: string | null;
    regionCode: string | null;
  };
  character: {
    normalizedName: string;
    regionCode: string;
    realmSlug: string;
  };
}): boolean {
  const digestRegion = input.digest.regionCode?.trim() ?? "";
  const digestRealm = input.digest.realmSlug?.trim() ?? "";
  const digestName = input.digest.characterName?.trim() ?? "";
  if (!digestRegion || !digestRealm || !digestName) return false;

  if (normalizeRegion(digestRegion) !== normalizeRegion(input.character.regionCode)) {
    return false;
  }
  if (normalizeRealmSlug(digestRealm) !== normalizeRealmSlug(input.character.realmSlug)) {
    return false;
  }
  if (normalizeName(digestName) !== normalizeName(input.character.normalizedName)) {
    return false;
  }
  return true;
}

export async function backfillCharacterRunDigestLinks(input: {
  prisma: PrismaClient;
  characterId: string;
  digests?: CharacterRunDigestRepository;
}): Promise<CharacterRunDigestBackfillResult> {
  const digests = input.digests ?? new CharacterRunDigestRepository(input.prisma);
  const character = await input.prisma.character.findUnique({
    where: { id: input.characterId },
    select: {
      id: true,
      normalizedName: true,
      region: { select: { code: true } },
      realm: { select: { slug: true } },
    },
  });
  if (!character) {
    return emptyResult(input.characterId);
  }

  const regionCode = character.region?.code?.trim() ?? "";
  const realmSlug = character.realm?.slug?.trim() ?? "";
  const normalizedName = character.normalizedName?.trim() ?? "";
  if (!regionCode || !realmSlug || !normalizedName) {
    return {
      ...emptyResult(input.characterId),
      skippedIncompleteIdentity: 1,
    };
  }

  const identity = {
    normalizedName,
    regionCode: normalizeRegion(regionCode),
    realmSlug: normalizeRealmSlug(realmSlug),
  };

  const candidates = await digests.listUnlinkedByRegionRealm({
    regionCode: identity.regionCode,
    realmSlug: identity.realmSlug,
  });

  const matched = candidates.filter((row) =>
    digestMatchesCharacterIdentity({
      digest: row,
      character: identity,
    }),
  );

  // Fail closed: if the realm/region bucket contains name-colliding rows with
  // incomplete identity fields that we cannot safely accept, refuse the batch.
  const incompleteSameName = candidates.filter((row) => {
    const nameOk = normalizeName(row.characterName) === normalizeName(identity.normalizedName);
    if (!nameOk) return false;
    const regionOk = Boolean(row.regionCode?.trim());
    const realmOk = Boolean(row.realmSlug?.trim());
    return !regionOk || !realmOk;
  });
  if (incompleteSameName.length > 0) {
    return {
      ...emptyResult(input.characterId),
      matched: matched.length,
      skippedIncompleteIdentity: incompleteSameName.length,
    };
  }

  const result: CharacterRunDigestBackfillResult = {
    characterId: input.characterId,
    matched: matched.length,
    linked: 0,
    alreadyLinked: 0,
    skippedIncompleteIdentity: 0,
    skippedConflict: 0,
    digestIdsLinked: [],
  };

  for (const row of matched) {
    try {
      const linked = await digests.attachCharacter({
        digestId: row.id,
        characterId: input.characterId,
      });
      if (linked.characterId === input.characterId) {
        // attachCharacter is idempotent; count first-time links via prior null.
        result.linked += 1;
        result.digestIdsLinked.push(row.id);
      }
    } catch (error) {
      if (error instanceof CharacterRunDigestCharacterLinkConflictError) {
        result.skippedConflict += 1;
        continue;
      }
      throw error;
    }
  }

  // Idempotent second pass: count already-linked digests for observability.
  const already = await input.prisma.characterRunDigest.count({
    where: {
      characterId: input.characterId,
      regionCode: { equals: identity.regionCode, mode: "insensitive" },
      realmSlug: { equals: identity.realmSlug, mode: "insensitive" },
    },
  });
  // Approximate alreadyLinked as total linked for this identity minus just-linked
  // in this invocation (best-effort; not used for control flow).
  result.alreadyLinked = Math.max(0, already - result.linked);

  return result;
}
