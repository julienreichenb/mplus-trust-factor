import type { Prisma, PrismaClient } from "@prisma/client";

export interface CharacterScoreIdentity {
  characterId: string;
  seasonId: string;
  scoringVersion: string;
}

export interface SaveCharacterScoreInput extends CharacterScoreIdentity {
  performance?: number | null;
  utility?: number | null;
  survival?: number | null;
  experience?: number | null;
  composite?: number | null;
  confidence?: number | null;
  tier?: string | null;
  dimensionDetails?: Prisma.InputJsonValue | null;
  selectedRuns: Prisma.InputJsonValue;
  calculatedAt?: Date;
}

export class CharacterScoreRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async find(identity: CharacterScoreIdentity) {
    return this.prisma.characterScore.findUnique({
      where: {
        characterId_seasonId_scoringVersion: identity,
      },
    });
  }

  async findLatestForCharacter(characterId: string) {
    return this.prisma.characterScore.findFirst({
      where: { characterId },
      orderBy: { calculatedAt: "desc" },
      include: { season: { select: { slug: true } } },
    });
  }

  async save(input: SaveCharacterScoreInput) {
    const calculatedAt = input.calculatedAt ?? new Date();
    return this.prisma.characterScore.upsert({
      where: {
        characterId_seasonId_scoringVersion: {
          characterId: input.characterId,
          seasonId: input.seasonId,
          scoringVersion: input.scoringVersion,
        },
      },
      create: {
        characterId: input.characterId,
        seasonId: input.seasonId,
        scoringVersion: input.scoringVersion,
        performance: input.performance ?? null,
        utility: input.utility ?? null,
        survival: input.survival ?? null,
        experience: input.experience ?? null,
        composite: input.composite ?? null,
        confidence: input.confidence ?? null,
        tier: input.tier ?? null,
        dimensionDetails: input.dimensionDetails ?? undefined,
        selectedRuns: input.selectedRuns,
        calculatedAt,
      },
      update: {
        performance: input.performance ?? null,
        utility: input.utility ?? null,
        survival: input.survival ?? null,
        experience: input.experience ?? null,
        composite: input.composite ?? null,
        confidence: input.confidence ?? null,
        tier: input.tier ?? null,
        dimensionDetails: input.dimensionDetails ?? undefined,
        selectedRuns: input.selectedRuns,
        calculatedAt,
      },
    });
  }
}

export function createCharacterScoreRepository(
  prisma: PrismaClient,
): CharacterScoreRepository {
  return new CharacterScoreRepository(prisma);
}
