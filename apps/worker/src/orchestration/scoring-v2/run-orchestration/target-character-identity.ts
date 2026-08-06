/**
 * Stable target-character identity for digest selection.
 * WCL actor IDs are report-local and must not be the sole cross-revision key.
 */
import { nameRealmMatches, normalizeWclRealmSlug } from "@mplus/provider-warcraftlogs";
import type { ParticipantScoringDigestV1 } from "@mplus/contracts";

export type TargetCharacterDigestFailureCode =
  | "TARGET_CHARACTER_DIGEST_MISSING"
  | "TARGET_CHARACTER_DIGEST_AMBIGUOUS";

export class TargetCharacterDigestError extends Error {
  readonly code: TargetCharacterDigestFailureCode;
  readonly slotId: string;
  readonly matchCount: number;

  constructor(
    code: TargetCharacterDigestFailureCode,
    slotId: string,
    matchCount: number,
    detail?: string,
  ) {
    super(
      detail ??
        `${code}:slot=${slotId}:matches=${matchCount}`,
    );
    this.name = "TargetCharacterDigestError";
    this.code = code;
    this.slotId = slotId;
    this.matchCount = matchCount;
  }
}

export interface StableCharacterIdentity {
  characterId: string;
  characterName: string;
  regionCode: string;
  realmSlug: string;
}

export interface RosterParticipantIdentity {
  wclActorId: number;
  characterName: string;
  realmSlug: string;
  regionCode: string;
  characterId?: string | null;
}

export interface DigestIdentityView {
  participantActorId: number;
  characterId: string | null;
  characterName: string;
  digest: ParticipantScoringDigestV1;
  digestArtifactId: string;
}

function normalizeName(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

/**
 * Resolve the report-local actor id for the target character from master/roster
 * participants using stable name+realm (+ optional region). Actor IDs alone are
 * never sufficient across revisions.
 */
export function resolveTargetActorIdFromRoster(input: {
  roster: readonly RosterParticipantIdentity[];
  identity: StableCharacterIdentity;
}): {
  actorId: number | null;
  matchCount: number;
  reason: "RESOLVED" | "NOT_FOUND" | "AMBIGUOUS";
} {
  const matches = input.roster.filter((p) => {
    if (p.characterId != null && p.characterId === input.identity.characterId) {
      return true;
    }
    const regionOk =
      !p.regionCode ||
      normalizeName(p.regionCode) === normalizeName(input.identity.regionCode);
    return (
      regionOk &&
      nameRealmMatches(
        p.characterName,
        p.realmSlug,
        input.identity.characterName,
        input.identity.realmSlug,
      )
    );
  });
  if (matches.length === 0) {
    return { actorId: null, matchCount: 0, reason: "NOT_FOUND" };
  }
  if (matches.length > 1) {
    const uniqueActors = new Set(matches.map((m) => m.wclActorId));
    if (uniqueActors.size > 1) {
      return { actorId: null, matchCount: matches.length, reason: "AMBIGUOUS" };
    }
  }
  return {
    actorId: matches[0]!.wclActorId,
    matchCount: matches.length,
    reason: "RESOLVED",
  };
}

/**
 * Select exactly one target-character digest for a fight.
 * Prefer roster actor match; fall back to stamped characterId / real name
 * (never ActorN placeholders alone).
 */
export function selectTargetCharacterDigest(input: {
  slotId: string;
  digests: readonly DigestIdentityView[];
  identity: StableCharacterIdentity;
  /** Report-local actor from roster / master data when known. */
  targetActorId: number | null;
  requireExactlyOne?: boolean;
}): DigestIdentityView {
  const requireExactlyOne = input.requireExactlyOne !== false;
  const byActor =
    input.targetActorId != null
      ? input.digests.filter((d) => d.participantActorId === input.targetActorId)
      : [];

  const byStamp = input.digests.filter((d) => {
    if (d.characterId === input.identity.characterId) return true;
    if (/^Actor\d+$/i.test(d.characterName)) return false;
    return (
      normalizeName(d.characterName) === normalizeName(input.identity.characterName)
    );
  });

  const matches =
    byActor.length === 1
      ? byActor
      : byActor.length > 1
        ? byActor
        : byStamp;

  if (matches.length === 0) {
    if (!requireExactlyOne) {
      throw new TargetCharacterDigestError(
        "TARGET_CHARACTER_DIGEST_MISSING",
        input.slotId,
        0,
      );
    }
    throw new TargetCharacterDigestError(
      "TARGET_CHARACTER_DIGEST_MISSING",
      input.slotId,
      0,
    );
  }
  if (matches.length > 1) {
    throw new TargetCharacterDigestError(
      "TARGET_CHARACTER_DIGEST_AMBIGUOUS",
      input.slotId,
      matches.length,
    );
  }
  return matches[0]!;
}

export function isUsablePerformanceDigest(
  digest: ParticipantScoringDigestV1,
): boolean {
  return (
    digest.performance.completeness !== "UNAVAILABLE" &&
    digest.performance.parseSemantic !== "UNAVAILABLE" &&
    digest.performance.parsePercentile != null
  );
}

export function normalizeRealmForCompare(realm: string): string {
  return normalizeWclRealmSlug(realm);
}
