/**
 * Persist fight-local WCL rankings independently of combat-event acquisition.
 * Inserts an append-only ranking snapshot; identical content is reused.
 */
import { WclFightRankingRepository } from "@mplus/database";
import type { PrismaClient } from "@mplus/database";
import { selectAlignedFriendlyRankings, type ReportActorRef } from "@mplus/provider-warcraftlogs";

function asActors(masterData: unknown): ReportActorRef[] {
  if (masterData == null || typeof masterData !== "object") return [];
  const actors = (masterData as { actors?: unknown }).actors;
  if (!Array.isArray(actors)) return [];
  return actors.flatMap((a) => {
    if (a == null || typeof a !== "object") return [];
    const rec = a as Record<string, unknown>;
    if (typeof rec.id !== "number" || typeof rec.name !== "string" || typeof rec.type !== "string") {
      return [];
    }
    return [
      {
        id: rec.id,
        name: rec.name,
        type: rec.type,
        subType: typeof rec.subType === "string" ? rec.subType : null,
        server: typeof rec.server === "string" ? rec.server : null,
      },
    ];
  });
}

export async function persistWclFightRankingsFromReport(input: {
  prisma: PrismaClient;
  rawRunId: string;
  rankings: unknown;
  masterData: unknown;
  friendlyPlayers: unknown;
  fightId?: number | null;
  fetchedAt?: Date;
}): Promise<{
  status: "skipped" | "persisted";
  created: boolean;
  snapshotId: string | null;
  alignedCount: number;
  ambiguousActorIds: number[];
}> {
  if (input.rankings == null) {
    return {
      status: "skipped",
      created: false,
      snapshotId: null,
      alignedCount: 0,
      ambiguousActorIds: [],
    };
  }
  const selected = selectAlignedFriendlyRankings({
    rankings: input.rankings,
    actors: asActors(input.masterData),
    friendlyPlayers: input.friendlyPlayers,
    fightId: input.fightId,
  });
  const repo = new WclFightRankingRepository(input.prisma);
  const { snapshot, created } = await repo.insertSnapshotIfNew({
    rawRunId: input.rawRunId,
    fetchedAt: input.fetchedAt,
    rows: selected.rows
      .filter((r) => r.actorId != null)
      .map((r) => ({
        reportActorId: r.actorId!,
        wclCharacterId: r.wclCharacterId,
        name: r.name ?? "unknown",
        realmName: r.server,
        role: r.role,
        spec: r.spec,
        className: r.className,
        bracketPercent: r.bracketPercent,
        rankPercent: r.rankPercent,
      })),
  });
  return {
    status: "persisted",
    created,
    snapshotId: snapshot.id,
    alignedCount: selected.rows.length,
    ambiguousActorIds: selected.ambiguousActorIds,
  };
}
