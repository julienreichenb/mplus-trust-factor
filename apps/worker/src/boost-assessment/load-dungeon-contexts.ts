import type { PrismaClient } from "@mplus/database";
import type { BoostDungeonContext } from "@mplus/scoring";

/**
 * Provider-free: read already-persisted timed MythicRuns for Boost interpretation.
 * Does not discover, fetch, or change canonical Trust selection.
 */
export async function loadBoostDungeonContexts(input: {
  prisma: PrismaClient;
  characterId: string;
  seasonId: string;
}): Promise<BoostDungeonContext[]> {
  const delegate = input.prisma.mythicRun;
  if (!delegate || typeof delegate.findMany !== "function") return [];
  const runs = await delegate.findMany({
    where: {
      seasonId: input.seasonId,
      timed: true,
      participants: { some: { characterId: input.characterId } },
    },
    include: {
      dungeon: { select: { slug: true } },
      sources: true,
    },
  });
  const byDungeon = new Map<string, typeof runs>();
  for (const run of runs) {
    const slug = run.dungeon.slug.trim().toLowerCase();
    const list = byDungeon.get(slug) ?? [];
    list.push(run);
    byDungeon.set(slug, list);
  }
  const contexts: BoostDungeonContext[] = [];
  for (const [dungeonSlug, list] of [...byDungeon.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const blizzardBest = [...list].sort((a, b) => b.keyLevel - a.keyLevel || b.completedAt.getTime() - a.completedAt.getTime())[0]!;
    const mapped = list.filter((r) =>
      r.sources.some((s) => s.provider === "WARCRAFT_LOGS" && s.reportCode && s.fightId != null),
    );
    const publicBest =
      mapped.length === 0
        ? null
        : [...mapped].sort((a, b) => b.keyLevel - a.keyLevel)[0]!;
    const publicSource = publicBest?.sources.find(
      (s) => s.provider === "WARCRAFT_LOGS" && s.reportCode && s.fightId != null,
    );
    const blizzardKey = blizzardBest.keyLevel;
    const publicKey = publicBest?.keyLevel ?? null;
    const topPublicEvidenceAvailable = publicKey != null && publicKey >= blizzardKey;
    contexts.push({
      dungeonSlug,
      blizzardBestKeyLevel: blizzardKey,
      blizzardBestCompletedAt: blizzardBest.completedAt.toISOString(),
      blizzardBestMythicRunId: blizzardBest.id,
      publicAnalysableBestKeyLevel: publicKey,
      publicAnalysableCode: publicSource?.reportCode ?? null,
      publicAnalysableFightId: publicSource?.fightId ?? null,
      topPublicEvidenceAvailable,
      keyLevelVerificationGap:
        publicKey == null ? blizzardKey : Math.max(0, blizzardKey - publicKey),
    });
  }
  return contexts;
}
