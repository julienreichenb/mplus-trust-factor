import type { Prisma, PrismaClient } from "@prisma/client";

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
   * Never creates a Character row.
   */
  async save(input: SaveCharacterRunDigestInput) {
    const identity = {
      rawRunId: input.rawRunId,
      participantActorId: input.participantActorId,
      extractorVersion: input.extractorVersion,
    };
    const existing = await this.find(identity);
    const characterId =
      input.characterId ?? existing?.characterId ?? null;

    if (!existing) {
      return this.prisma.characterRunDigest.create({
        data: {
          rawRunId: input.rawRunId,
          participantActorId: input.participantActorId,
          extractorVersion: input.extractorVersion,
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
    }

    return this.prisma.characterRunDigest.update({
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
  }

  /**
   * Link an existing digest to an existing Character UUID.
   * Does not create Character rows. Idempotent for the same link.
   * Throws when the digest is already linked to a different character.
   */
  async attachCharacter(input: {
    digestId: string;
    characterId: string;
  }) {
    const row = await this.prisma.characterRunDigest.findUnique({
      where: { id: input.digestId },
    });
    if (!row) {
      throw Object.assign(
        new Error(`character_run_digest_not_found:${input.digestId}`),
        { code: "CHARACTER_RUN_DIGEST_NOT_FOUND" },
      );
    }
    if (row.characterId != null && row.characterId !== input.characterId) {
      throw new CharacterRunDigestCharacterLinkConflictError({
        digestId: input.digestId,
        existingCharacterId: row.characterId,
        requestedCharacterId: input.characterId,
      });
    }
    if (row.characterId === input.characterId) {
      return row;
    }

    // Ensure the Character exists; never auto-create.
    await this.prisma.character.findUniqueOrThrow({
      where: { id: input.characterId },
      select: { id: true },
    });

    return this.prisma.characterRunDigest.update({
      where: { id: input.digestId },
      data: { characterId: input.characterId },
    });
  }
}

export function createCharacterRunDigestRepository(
  prisma: PrismaClient,
): CharacterRunDigestRepository {
  return new CharacterRunDigestRepository(prisma);
}
