import type { Prisma, PrismaClient } from "@prisma/client";
import { Prisma as PrismaNamespace } from "@prisma/client";

export interface CharacterDigestIdentity {
  rawRunId: string;
  participantActorId: number;
  extractorVersion: string;
}

export interface SaveCharacterRunDigestInput extends CharacterDigestIdentity {
  characterId?: string | null;
  characterName: string;
  realmSlug?: string | null;
  regionCode?: string | null;
  classSlug?: string | null;
  specSlug?: string | null;
  role?: string | null;
  offensive: Prisma.InputJsonValue;
  utility: Prisma.InputJsonValue;
  survival: Prisma.InputJsonValue;
  sourceMetadata: Prisma.InputJsonValue;
}

export class CharacterRunDigestCharacterLinkConflictError extends Error {
  readonly code = "CHARACTER_RUN_DIGEST_CHARACTER_LINK_CONFLICT" as const;
  readonly digestId: string;
  readonly existingCharacterId: string;
  readonly requestedCharacterId: string;

  constructor(input: {
    digestId: string;
    existingCharacterId: string;
    requestedCharacterId: string;
  }) {
    super(
      `character_run_digest_character_link_conflict:digest=${input.digestId}:existing=${input.existingCharacterId}:requested=${input.requestedCharacterId}`,
    );
    this.name = "CharacterRunDigestCharacterLinkConflictError";
    this.digestId = input.digestId;
    this.existingCharacterId = input.existingCharacterId;
    this.requestedCharacterId = input.requestedCharacterId;
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof PrismaNamespace.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

type DigestTx = Pick<PrismaClient, "characterRunDigest" | "character" | "$queryRaw">;

function mergeCharacterId(input: {
  digestId: string;
  existingCharacterId: string | null;
  incomingCharacterId: string | null | undefined;
}): string | null {
  const incoming = input.incomingCharacterId ?? null;
  const existing = input.existingCharacterId;
  if (
    existing != null &&
    incoming != null &&
    existing !== incoming
  ) {
    throw new CharacterRunDigestCharacterLinkConflictError({
      digestId: input.digestId,
      existingCharacterId: existing,
      requestedCharacterId: incoming,
    });
  }
  return incoming ?? existing ?? null;
}

export class CharacterRunDigestRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async find(identity: CharacterDigestIdentity) {
    return this.prisma.characterRunDigest.findUnique({
      where: {
        rawRunId_participantActorId_extractorVersion: identity,
      },
    });
  }

  /**
   * Upsert by raw run + fight-local actor + extractor version.
   * Never replaces an existing non-null characterId with null.
   * Never silently replaces Character A with Character B.
   * Never creates a Character row.
   * Concurrent creates are resolved via unique-constraint retry.
   */
  async save(input: SaveCharacterRunDigestInput) {
    const runOnce = async (tx: DigestTx) => {
      // Lock existing row (if any) so concurrent attach/save cannot race on characterId.
      const locked = await tx.$queryRaw<
        Array<{ id: string; character_id: string | null }>
      >`
        SELECT id, character_id
        FROM character_run_digests
        WHERE raw_run_id = ${input.rawRunId}::uuid
          AND participant_actor_id = ${input.participantActorId}
          AND extractor_version = ${input.extractorVersion}
        FOR UPDATE
      `;
      const existing = locked[0];

      if (!existing) {
        return tx.characterRunDigest.create({
          data: {
            rawRunId: input.rawRunId,
            participantActorId: input.participantActorId,
            extractorVersion: input.extractorVersion,
            characterId: input.characterId ?? null,
            characterName: input.characterName,
            realmSlug: input.realmSlug ?? null,
            regionCode: input.regionCode ?? null,
            classSlug: input.classSlug ?? null,
            specSlug: input.specSlug ?? null,
            role: input.role ?? null,
            offensive: input.offensive,
            utility: input.utility,
            survival: input.survival,
            sourceMetadata: input.sourceMetadata,
          },
        });
      }

      const characterId = mergeCharacterId({
        digestId: existing.id,
        existingCharacterId: existing.character_id,
        incomingCharacterId: input.characterId,
      });

      return tx.characterRunDigest.update({
        where: { id: existing.id },
        data: {
          characterId,
          characterName: input.characterName,
          realmSlug: input.realmSlug ?? null,
          regionCode: input.regionCode ?? null,
          classSlug: input.classSlug ?? null,
          specSlug: input.specSlug ?? null,
          role: input.role ?? null,
          offensive: input.offensive,
          utility: input.utility,
          survival: input.survival,
          sourceMetadata: input.sourceMetadata,
        },
      });
    };

    try {
      return await this.prisma.$transaction((tx) => runOnce(tx));
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      // Concurrent insert won the unique key — retry as locked update.
      return this.prisma.$transaction((tx) => runOnce(tx));
    }
  }

  /**
   * Link an existing digest to an existing Character UUID.
   * Does not create Character rows. Idempotent for the same link.
   * Throws when the digest is already linked to a different character.
   * Uses a row lock so concurrent attaches cannot overwrite each other.
   */
  async attachCharacter(input: {
    digestId: string;
    characterId: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<
        Array<{ id: string; character_id: string | null }>
      >`
        SELECT id, character_id
        FROM character_run_digests
        WHERE id = ${input.digestId}::uuid
        FOR UPDATE
      `;
      const row = locked[0];
      if (!row) {
        throw Object.assign(
          new Error(`character_run_digest_not_found:${input.digestId}`),
          { code: "CHARACTER_RUN_DIGEST_NOT_FOUND" },
        );
      }
      if (row.character_id != null && row.character_id !== input.characterId) {
        throw new CharacterRunDigestCharacterLinkConflictError({
          digestId: input.digestId,
          existingCharacterId: row.character_id,
          requestedCharacterId: input.characterId,
        });
      }
      if (row.character_id === input.characterId) {
        return tx.characterRunDigest.findUniqueOrThrow({
          where: { id: input.digestId },
        });
      }

      // Ensure the Character exists; never auto-create.
      await tx.character.findUniqueOrThrow({
        where: { id: input.characterId },
        select: { id: true },
      });

      return tx.characterRunDigest.update({
        where: { id: input.digestId },
        data: { characterId: input.characterId },
      });
    });
  }
}

export function createCharacterRunDigestRepository(
  prisma: PrismaClient,
): CharacterRunDigestRepository {
  return new CharacterRunDigestRepository(prisma);
}
