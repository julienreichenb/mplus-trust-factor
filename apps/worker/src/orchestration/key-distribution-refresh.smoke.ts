/**
 * Local smoke: ingest EU Raider.IO addon into SeasonMedianKeyDistributionSnapshot.
 * Does not commit the zip. Requires DATABASE_URL and GitHub network.
 *
 *   pnpm --filter @mplus/worker exec tsx src/orchestration/key-distribution-refresh.smoke.ts
 */
import { loadEnv } from "@mplus/config";
import { createPrismaClient } from "@mplus/database";
import { createLogger } from "@mplus/observability";
import { ADMIN_SCORING_DEFAULT_REGION } from "@mplus/contracts";
import { randomUUID } from "node:crypto";
import { peekEffectiveScoringSeasonRowGlobal } from "./active-mplus-season/effective-season-peek.js";
import { runKeyDistributionRefresh } from "./key-distribution-refresh.js";

const env = loadEnv();
const prisma = createPrismaClient(env.DATABASE_URL);
const logger = createLogger({ level: "info", name: "key-distribution-smoke" });
const started = Date.now();
const mem0 = process.memoryUsage().heapUsed;
try {
  const season = await peekEffectiveScoringSeasonRowGlobal(prisma);
  if (!season) throw new Error("No effective scoring season");
  const refreshId = randomUUID();
  await prisma.scoreContextKeyDistributionRefresh.create({
    data: {
      id: refreshId,
      seasonId: season.id,
      region: ADMIN_SCORING_DEFAULT_REGION,
      status: "QUEUED",
    },
  });
  const result = await runKeyDistributionRefresh({
    prisma,
    logger,
    refreshId,
    seasonId: season.id,
    region: ADMIN_SCORING_DEFAULT_REGION,
  });
  const snapshot = await prisma.seasonMedianKeyDistributionSnapshot.findUnique({ where: { id: result.snapshotId } });
  const mem1 = process.memoryUsage().heapUsed;
  console.log(
    JSON.stringify(
      {
        seasonId: season.id,
        snapshotId: result.snapshotId,
        reused: result.reused,
        sourceVersion: snapshot?.sourceVersion,
        points: snapshot?.points,
        provenance: snapshot?.provenance,
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
