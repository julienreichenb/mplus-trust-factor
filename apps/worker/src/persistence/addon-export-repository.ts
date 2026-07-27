import type { AddonExport, AddonExportStatus, PrismaClient } from "@mplus/database";

export interface CreateAddonExportInput {
  regionId: string;
  seasonId: string;
  scoreModelId: string;
  generatedAt: Date;
  characterCount: number;
  formatVersion: string;
  checksum: string;
  artifactId?: string | null;
  status?: AddonExportStatus;
  metadata?: unknown;
}

export interface AddonExportRepository {
  create(input: CreateAddonExportInput): Promise<AddonExport>;
  findLatest(regionId: string, seasonId: string, scoreModelId: string): Promise<AddonExport | null>;
}

export function createAddonExportRepository(prisma: PrismaClient): AddonExportRepository {
  return {
    async create(input) {
      return prisma.addonExport.create({
        data: {
          regionId: input.regionId,
          seasonId: input.seasonId,
          scoreModelId: input.scoreModelId,
          generatedAt: input.generatedAt,
          characterCount: input.characterCount,
          formatVersion: input.formatVersion,
          checksum: input.checksum,
          artifactId: input.artifactId ?? null,
          status: input.status ?? "READY",
          metadata: (input.metadata ?? {}) as object,
        },
      });
    },

    async findLatest(regionId, seasonId, scoreModelId) {
      return prisma.addonExport.findFirst({
        where: { regionId, seasonId, scoreModelId },
        orderBy: { generatedAt: "desc" },
      });
    },
  };
}
