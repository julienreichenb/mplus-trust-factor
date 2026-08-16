import type { PrismaClient } from "@mplus/database";
import { WclFightRankingRepository } from "@mplus/database";
import type { BoostPeerParse, BoostRunInput } from "@mplus/scoring";
import { pickUniqueRaw } from "./pick-unique-raw.js";

export async function attachRankingSnapshot(input: {
  prisma: PrismaClient;
  reportCode: string | null;
  fightId: number | null;
  reportRevision: number | null;
  subjectActorId: number | null;
}): Promise<{
  rawRunId: string | null;
  rankingSnapshotId: string | null;
  rankingSnapshotContentHash: string | null;
  subjectKeyParse: number | null;
  peerKeyParses: BoostPeerParse[];
  missingReason: BoostRunInput["missingReason"];
}> {
  const empty = {
    rawRunId: null as string | null,
    rankingSnapshotId: null as string | null,
    rankingSnapshotContentHash: null as string | null,
    subjectKeyParse: null as number | null,
    peerKeyParses: [] as BoostPeerParse[],
    missingReason: "NO_COMPATIBLE_RAW" as BoostRunInput["missingReason"],
  };
  if (!input.prisma.wclRunRaw || typeof input.prisma.wclRunRaw.findMany !== "function") {
    return { ...empty, missingReason: "NO_RANKING_SNAPSHOT" };
  }
  if (input.reportCode == null || input.fightId == null) {
    return empty;
  }
  const candidates = await input.prisma.wclRunRaw.findMany({
    where: { reportCode: input.reportCode, fightId: input.fightId },
    select: {
      id: true,
      reportCode: true,
      fightId: true,
      reportRevision: true,
      acquisitionVersion: true,
    },
  });
  const picked = pickUniqueRaw(candidates, input.reportRevision);
  if (picked === "ambiguous") {
    return { ...empty, missingReason: "AMBIGUOUS_WCL_ALIGNMENT" };
  }
  if (!picked) {
    return { ...empty, missingReason: "NO_COMPATIBLE_RAW" };
  }
  const rankingRepo = new WclFightRankingRepository(input.prisma);
  const compatible = await rankingRepo.findLatestSnapshotForRawRun(picked.id);
  if (!compatible) {
    const anySnap = await rankingRepo.findLatestSnapshotAnyVersion(picked.id);
    return {
      ...empty,
      rawRunId: picked.id,
      missingReason: anySnap ? "INCOMPATIBLE_RANKING_SEMANTIC" : "NO_RANKING_SNAPSHOT",
    };
  }
  const snapshot = compatible;
  const entries = snapshot.entries ?? [];
  if (input.subjectActorId == null) {
    return {
      rawRunId: picked.id,
      rankingSnapshotId: snapshot.id,
      rankingSnapshotContentHash: snapshot.contentHash,
      subjectKeyParse: null,
      peerKeyParses: [],
      missingReason: "SUBJECT_ACTOR_UNALIGNED",
    };
  }
  const subjectRow = entries.find((r: { reportActorId: number }) => r.reportActorId === input.subjectActorId);
  let subjectKeyParse: number | null = null;
  let missingReason: BoostRunInput["missingReason"] = null;
  if (subjectRow && typeof subjectRow.bracketPercent === "number" && Number.isFinite(subjectRow.bracketPercent)) {
    subjectKeyParse = subjectRow.bracketPercent;
  } else {
    missingReason = "SUBJECT_BRACKET_PERCENT_MISSING";
  }
  const peerKeyParses: BoostPeerParse[] = [];
  for (const row of entries) {
    if (row.reportActorId === input.subjectActorId) continue;
    if (typeof row.bracketPercent !== "number" || !Number.isFinite(row.bracketPercent)) continue;
    peerKeyParses.push({
      identityKey: row.wclCharacterId != null ? `wcl:${row.wclCharacterId}` : `actor:${row.reportActorId}`,
      displayName: row.name,
      keyParse: row.bracketPercent,
      role: row.role ?? null,
    });
  }
  return {
    rawRunId: picked.id,
    rankingSnapshotId: snapshot.id,
    rankingSnapshotContentHash: snapshot.contentHash,
    subjectKeyParse,
    peerKeyParses,
    missingReason,
  };
}
