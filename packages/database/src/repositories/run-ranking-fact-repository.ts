import type { Prisma, PrismaClient } from "@prisma/client";

export interface RankingFactIdentity {
  rawRunId: string;
  characterId: string;
  rankingVersion: string;
}

export interface SaveRunRankingFactInput extends RankingFactIdentity {
  payload: Prisma.InputJsonValue;
  fetchedAt?: Date;
}

export class RunRankingFactRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async find(identity: RankingFactIdentity) {
    return this.prisma.runRankingFact.findUnique({
      where: {
        rawRunId_characterId_rankingVersion: identity,
      },
    });
  }

  async save(input: SaveRunRankingFactInput) {
    const fetchedAt = input.fetchedAt ?? new Date();
    return this.prisma.runRankingFact.upsert({
      where: {
        rawRunId_characterId_rankingVersion: {
          rawRunId: input.rawRunId,
          characterId: input.characterId,
          rankingVersion: input.rankingVersion,
        },
      },
      create: {
        rawRunId: input.rawRunId,
        characterId: input.characterId,
        rankingVersion: input.rankingVersion,
        payload: input.payload,
        fetchedAt,
      },
      update: {
        payload: input.payload,
        fetchedAt,
      },
    });
  }
}

export function createRunRankingFactRepository(
  prisma: PrismaClient,
): RunRankingFactRepository {
  return new RunRankingFactRepository(prisma);
}
