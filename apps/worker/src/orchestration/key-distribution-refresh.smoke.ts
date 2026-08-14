/**
 * Local smoke: ingest Raider.IO addon into regional SeasonMedianKeyDistributionSnapshot rows.
 * Does not commit the zip. Requires DATABASE_URL and GitHub network.
 *
 *   pnpm --filter @mplus/worker exec tsx src/orchestration/key-distribution-refresh.smoke.ts
 */
import { loadEnv } from "@mplus/config";
import { createPrismaClient } from "@mplus/database";
import { createLogger } from "@mplus/observability";
import { KEY_CONTEXT_REGION_CODES, type KeyContextRegionCode } from "@mplus/contracts";
import { randomUUID } from "node:crypto";
import { peekEffectiveScoringSeasonRowGlobal } from "./active-mplus-season/effective-season-peek.js";
import { runKeyDistributionRefresh } from "./key-distribution-refresh.js";

const env = loadEnv();
const prisma = createPrismaClient(env.DATABASE_URL);
const logger = createLogger({ level: "info", name: "key-distribution-smoke" });
const started = Date.now();
const mem0 = process.memoryUsage().heapUsed;
try {
  const peek = await peekEffectiveScoringSeasonRowGlobal(prisma);
  if (!peek?.blizzardSeasonId) throw new Error("No effective scoring season");
  const reports = [];
  for (const region of KEY_CONTEXT_REGION_CODES) {
    const season = await prisma.season.findFirst({
      where: { blizzardSeasonId: peek.blizzardSeasonId, region: { code: region } },
    });
    if (!season) {
      reports.push({ region, error: "SEASON_ROW_MISSING" });
      continue;
    }
    const refreshId = randomUUID();
    await prisma.scoreContextKeyDistributionRefresh.create({
      data: {
        id: refreshId,
        seasonId: season.id,
        region,
        status: "QUEUED",
      },
    });
    try {
      const result = await runKeyDistributionRefresh({
        prisma,
        logger,
        refreshId,
        seasonId: season.id,
        region: region as KeyContextRegionCode,
      });
      const snapshot = result.snapshotId
        ? await prisma.seasonMedianKeyDistributionSnapshot.findUnique({
            where: { id: result.snapshotId },
          })
        : null;
      const provenance = (snapshot?.provenance ?? {}) as Record<string, unknown>;
      reports.push({
        region,
        seasonId: season.id,
        snapshotId: result.snapshotId,
        reused: result.reused,
        contentHash: snapshot?.contentHash,
        sourceVersion: snapshot?.sourceVersion,
        points: snapshot?.points,
        indexedCharacters: provenance.indexedCharacters ?? null,
        eligibleCharacters: provenance.eligibleCharacters ?? null,
        provenance,
      });
    } catch (error) {
      reports.push({
        region,
        seasonId: season.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const mem1 = process.memoryUsage().heapUsed;
  console.log(
    JSON.stringify(
      {
        blizzardSeasonId: peek.blizzardSeasonId,
        reports,
        elapsedMs: Date.now() - started,
        heapDeltaMb: Number(((mem1 - mem0) / 1024 / 1024).toFixed(1)),
        heapUsedMb: Number((mem1 / 1024 / 1024).toFixed(1)),
      },
      null,
      2,
    ),
  );
} finally {
  await prisma.$disconnect();
}
