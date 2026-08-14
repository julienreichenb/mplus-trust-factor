import type { Prisma, PrismaClient } from "@prisma/client";
import { NONE_CONTEXT_REVISION_KEY } from "./season-score-context-repository.js";

export interface CharacterScoreIdentity {
  characterId: string;
  seasonId: string;
  scoringVersion: string;
  contextRevisionKey?: string;
}

export interface SaveCharacterScoreInput extends CharacterScoreIdentity {
  contextRevisionId?: string | null;
  performance?: number | null;
  utility?: number | null;
  survival?: number | null;
  experience?: number | null;
  composite?: number | null;
  contextualScore?: number | null;
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
        characterId_seasonId_scoringVersion_contextRevisionKey: {
          characterId: identity.characterId,
          seasonId: identity.seasonId,
          scoringVersion: identity.scoringVersion,
          contextRevisionKey: identity.contextRevisionKey ?? NONE_CONTEXT_REVISION_KEY,
        },
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
    const contextRevisionKey = input.contextRevisionKey ?? NONE_CONTEXT_REVISION_KEY;
    return this.prisma.characterScore.upsert({
      where: {
        characterId_seasonId_scoringVersion_contextRevisionKey: {
          characterId: input.characterId,
          seasonId: input.seasonId,
          scoringVersion: input.scoringVersion,
          contextRevisionKey,
        },
      },
      create: {
        characterId: input.characterId,
        seasonId: input.seasonId,
        scoringVersion: input.scoringVersion,
        contextRevisionKey,
        contextRevisionId: input.contextRevisionId ?? null,
        performance: input.performance ?? null,
        utility: input.utility ?? null,
        survival: input.survival ?? null,
        experience: input.experience ?? null,
        composite: input.composite ?? null,
        contextualScore: input.contextualScore ?? null,
        confidence: input.confidence ?? null,
        tier: input.tier ?? null,
        dimensionDetails: input.dimensionDetails ?? undefined,
        selectedRuns: input.selectedRuns,
        calculatedAt,
      },
      update: {
        contextRevisionId: input.contextRevisionId ?? null,
        performance: input.performance ?? null,
        utility: input.utility ?? null,
        survival: input.survival ?? null,
        experience: input.experience ?? null,
        composite: input.composite ?? null,
        contextualScore: input.contextualScore ?? null,
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
