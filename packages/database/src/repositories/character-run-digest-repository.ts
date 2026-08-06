import type { Prisma, PrismaClient } from "@prisma/client";

export interface CharacterDigestIdentity {
  rawRunId: string;
  characterId: string;
  extractorVersion: string;
}

export interface SaveCharacterRunDigestInput extends CharacterDigestIdentity {
  offensive: Prisma.InputJsonValue;
  utility: Prisma.InputJsonValue;
  survival: Prisma.InputJsonValue;
  sourceMetadata: Prisma.InputJsonValue;
}

export class CharacterRunDigestRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async find(identity: CharacterDigestIdentity) {
    return this.prisma.characterRunDigest.findUnique({
      where: {
        rawRunId_characterId_extractorVersion: identity,
      },
    });
  }

  async save(input: SaveCharacterRunDigestInput) {
    return this.prisma.characterRunDigest.upsert({
      where: {
        rawRunId_characterId_extractorVersion: {
          rawRunId: input.rawRunId,
          characterId: input.characterId,
          extractorVersion: input.extractorVersion,
        },
      },
      create: {
        rawRunId: input.rawRunId,
        characterId: input.characterId,
        extractorVersion: input.extractorVersion,
        offensive: input.offensive,
        utility: input.utility,
        survival: input.survival,
        sourceMetadata: input.sourceMetadata,
      },
      update: {
        offensive: input.offensive,
        utility: input.utility,
        survival: input.survival,
        sourceMetadata: input.sourceMetadata,
      },
    });
  }
}

export function createCharacterRunDigestRepository(
  prisma: PrismaClient,
): CharacterRunDigestRepository {
  return new CharacterRunDigestRepository(prisma);
}
