/**
 * Derive ParticipantScoringDigestV1 (v4) from frozen WclRunRaw.payload.
 * Uses production digest builder — no live WCL provider calls.
 */

import {
  parseWclRunRawPayload,
  assertParticipantScoringDigestV1,
  PARTICIPANT_DIGEST_EXTRACTOR_COMPAT_VERSION,
  type ParticipantScoringDigestV1,
} from "@mplus/contracts";
import {
  buildParticipantScoringDigestsFromPackage,
  inferFightBoundsFromCompactEvents,
} from "@mplus/provider-warcraftlogs/digest-build";
import {
  canonicalizeRetailClassSpecIdentity,
} from "@mplus/abilities";

export type DeriveV4DigestFromFrozenRawInput = {
  rawRunId: string;
  rawPayload: unknown;
  participantActorId: number;
  characterName: string;
  realmSlug: string | null;
  regionCode: string | null;
  classSlug: string | null;
  specSlug: string | null;
  role: string | null;
  /** Nested older digest used only for fight metadata / pets when present. */
  priorDigest?: Partial<ParticipantScoringDigestV1> | null;
};

export type DeriveV4DigestResult =
  | {
      ok: true;
      digest: ParticipantScoringDigestV1;
      sourceRawRunId: string;
    }
  | {
      ok: false;
      reason: string;
    };

/**
 * Deterministically rebuild a current extractor-compat digest from frozen raw
 * capability evidence. Does not persist. Does not call providers.
 */
export function deriveV4ParticipantDigestFromFrozenRaw(
  input: DeriveV4DigestFromFrozenRawInput,
): DeriveV4DigestResult {
  try {
    const parsed = parseWclRunRawPayload(input.rawPayload);
    const identity = canonicalizeRetailClassSpecIdentity({
      classSlug: input.classSlug,
      specSlug: input.specSlug,
    });
    const prior = input.priorDigest ?? null;
    const bounds = inferFightBoundsFromCompactEvents(parsed.package.compactEvents);
    const ownedPetActorIds =
      prior && Array.isArray(prior.ownedPetActorIds) ? prior.ownedPetActorIds : [];

    const built = buildParticipantScoringDigestsFromPackage({
      capabilityPackage: parsed.package,
      packageArtifactId: input.rawRunId,
      participants: [
        {
          playerActorId: input.participantActorId,
          characterName: input.characterName,
          realmSlug: input.realmSlug ?? undefined,
          regionCode: input.regionCode ?? undefined,
          classSlug: identity.classSlug,
          specSlug: identity.specSlug,
          role: input.role,
          ownedPetActorIds,
        },
      ],
      dungeonSlug:
        typeof prior?.dungeonSlug === "string"
          ? prior.dungeonSlug
          : (parsed.package.sourceKey as { dungeonSlug?: string } | undefined)?.dungeonSlug ??
            null,
      keyLevel: typeof prior?.keyLevel === "number" ? prior.keyLevel : null,
      timed: typeof prior?.timed === "boolean" ? prior.timed : null,
      runScore: typeof prior?.runScore === "number" ? prior.runScore : null,
      completedAt: typeof prior?.completedAt === "string" ? prior.completedAt : null,
      fightStartMs: bounds.fightStartMs,
      fightEndMs: bounds.fightEndMs,
      catalogVersion: parsed.package.catalogVersion,
      combatantInfoEvents: parsed.combatantInfoEvents,
      // Stable timestamp so derivation is deterministic across runs.
      createdAt: "1970-01-01T00:00:00.000Z",
    });

    const match =
      built.find((d) => d.participantActorId === input.participantActorId) ?? built[0];
    if (!match) {
      return { ok: false, reason: "DERIVE_NO_PARTICIPANT_DIGEST" };
    }
    const digest = assertParticipantScoringDigestV1(match);
    if (digest.extractorCompatVersion !== PARTICIPANT_DIGEST_EXTRACTOR_COMPAT_VERSION) {
      return { ok: false, reason: "DERIVE_UNEXPECTED_EXTRACTOR_VERSION" };
    }
    return { ok: true, digest, sourceRawRunId: input.rawRunId };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}
