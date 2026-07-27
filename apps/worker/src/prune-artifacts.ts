import type { PrismaClient } from "@mplus/database";

export interface PruneArtifactsResult {
  deletedCount: number;
}

/**
 * Deletes RawArtifact rows past their retention window.
 * Falls back to `now - retentionDays` when `retentionUntil` was never set.
 */
export async function pruneRawArtifacts(
  prisma: PrismaClient,
  retentionDays: number,
  now: Date = new Date(),
): Promise<PruneArtifactsResult> {
  const fallbackCutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);

  const result = await prisma.rawArtifact.deleteMany({
    where: {
      OR: [{ retentionUntil: { lt: now } }, { retentionUntil: null, createdAt: { lt: fallbackCutoff } }],
    },
  });

  return { deletedCount: result.count };
}
