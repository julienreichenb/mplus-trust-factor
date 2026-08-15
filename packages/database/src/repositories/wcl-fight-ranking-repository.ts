import type { PrismaClient } from "@prisma/client";
import {
  hashCanonicalJson,
  WCL_FIGHT_RANKING_ACQUISITION_VERSION,
  WCL_FIGHT_RANKING_LEGACY_ACQUISITION_VERSION,
} from "@mplus/contracts";

export {
  WCL_FIGHT_RANKING_ACQUISITION_VERSION,
  WCL_FIGHT_RANKING_LEGACY_ACQUISITION_VERSION,
};

export interface SaveWclFightRankingRow {
  reportActorId: number;
  wclCharacterId?: number | null;
  name: string;
  realmName?: string | null;
  role?: string | null;
  spec?: string | null;
  className?: string | null;
  bracketPercent?: number | null;
  rankPercent?: number | null;
}

export function rankingSnapshotContentHash(
  rows: SaveWclFightRankingRow[],
  rankingAcquisitionVersion: string = WCL_FIGHT_RANKING_ACQUISITION_VERSION,
): string {
  const canonical = [...rows]
    .map((row) => ({
      reportActorId: row.reportActorId,
      wclCharacterId: row.wclCharacterId ?? null,
      bracketPercent: row.bracketPercent ?? null,
      rankPercent: row.rankPercent ?? null,
    }))
    .sort((a, b) => a.reportActorId - b.reportActorId);
  return hashCanonicalJson({ rankingAcquisitionVersion, rows: canonical });
}

export class WclFightRankingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findLatestSnapshotForRawRun(
    rawRunId: string,
    rankingAcquisitionVersion: string = WCL_FIGHT_RANKING_ACQUISITION_VERSION,
  ) {
    const snapshots = this.prisma.wclFightRankingSnapshot;
    if (!snapshots || typeof snapshots.findFirst !== "function") return null;
    return snapshots.findFirst({
      where: { rawRunId, rankingAcquisitionVersion },
      orderBy: { fetchedAt: "desc" },
      include: { entries: true },
    });
  }

  async findLatestSnapshotAnyVersion(rawRunId: string) {
    const snapshots = this.prisma.wclFightRankingSnapshot;
    if (!snapshots || typeof snapshots.findFirst !== "function") return null;
    return snapshots.findFirst({
      where: { rawRunId },
      orderBy: { fetchedAt: "desc" },
      include: { entries: true },
    });
  }

  /**
   * Append-only: identical content for the same rawRunId + semantic version is reused.
   * A later fetch with different Key % or a new semantic version inserts a new snapshot.
   */
  async insertSnapshotIfNew(input: {
    rawRunId: string;
    rankingAcquisitionVersion?: string;
    fetchedAt?: Date;
    rows: SaveWclFightRankingRow[];
  }) {
    const rankingAcquisitionVersion =
      input.rankingAcquisitionVersion ?? WCL_FIGHT_RANKING_ACQUISITION_VERSION;
    const contentHash = rankingSnapshotContentHash(input.rows, rankingAcquisitionVersion);
    const existing = await this.prisma.wclFightRankingSnapshot.findUnique({
      where: {
        rawRunId_contentHash: { rawRunId: input.rawRunId, contentHash },
      },
      include: { entries: true },
    });
    if (existing) {
      return { snapshot: existing, created: false };
    }
    const fetchedAt = input.fetchedAt ?? new Date();
    const snapshot = await this.prisma.wclFightRankingSnapshot.create({
      data: {
        rawRunId: input.rawRunId,
        rankingAcquisitionVersion,
        contentHash,
        fetchedAt,
        entries: {
          create: input.rows.map((row) => ({
            reportActorId: row.reportActorId,
            wclCharacterId: row.wclCharacterId ?? null,
            name: row.name,
            realmName: row.realmName ?? null,
            role: row.role ?? null,
            spec: row.spec ?? null,
            className: row.className ?? null,
            bracketPercent: row.bracketPercent ?? null,
            rankPercent: row.rankPercent ?? null,
          })),
        },
      },
      include: { entries: true },
    });
    return { snapshot, created: true };
  }
}

export function createWclFightRankingRepository(prisma: PrismaClient) {
  return new WclFightRankingRepository(prisma);
}
