import type { Prisma, PrismaClient } from "@prisma/client";

export interface WclRunSourceIdentity {
  reportCode: string;
  fightId: number;
  reportRevision: number;
  acquisitionVersion: string;
}

export interface SaveWclRunRawInput extends WclRunSourceIdentity {
  payload: Prisma.InputJsonValue;
  fetchedAt?: Date;
  providerCost?: Prisma.InputJsonValue | null;
}

export class WclRunRawRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async find(identity: WclRunSourceIdentity) {
    return this.prisma.wclRunRaw.findUnique({
      where: {
        reportCode_fightId_reportRevision_acquisitionVersion: identity,
      },
    });
  }

  async save(input: SaveWclRunRawInput) {
    const fetchedAt = input.fetchedAt ?? new Date();
    return this.prisma.wclRunRaw.upsert({
      where: {
        reportCode_fightId_reportRevision_acquisitionVersion: {
          reportCode: input.reportCode,
          fightId: input.fightId,
          reportRevision: input.reportRevision,
          acquisitionVersion: input.acquisitionVersion,
        },
      },
      create: {
        reportCode: input.reportCode,
        fightId: input.fightId,
        reportRevision: input.reportRevision,
        acquisitionVersion: input.acquisitionVersion,
        payload: input.payload,
        fetchedAt,
        providerCost: input.providerCost ?? undefined,
      },
      update: {
        payload: input.payload,
        fetchedAt,
        providerCost: input.providerCost ?? undefined,
      },
    });
  }
}

export function createWclRunRawRepository(prisma: PrismaClient): WclRunRawRepository {
  return new WclRunRawRepository(prisma);
}
