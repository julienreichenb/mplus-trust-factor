/**
 * Local acceptance helper: inspect → optional reset was already run → refresh twice.
 *   pnpm --filter @mplus/api exec tsx src/cli/dev-refresh-acceptance.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, resetEnvCache } from "@mplus/config";
import { createPrismaClient } from "@mplus/database";
import { AbilityCatalogRefreshOrchestrationService } from "../services/ability-catalog-refresh-orchestration-service.js";

function loadDotEnvFile(path: string): void {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
loadDotEnvFile(resolve(root, ".env"));
resetEnvCache();
const env = loadEnv();

const prisma = createPrismaClient();

async function summarize(label: string) {
  const batches = await prisma.abilityCatalogReviewBatch.findMany({
    include: { items: { select: { kind: true, name: true, classSlug: true, raceSlugs: true, decisionAction: true } } },
    orderBy: { createdAt: "desc" },
  });
  const releases = await prisma.abilityCatalogRelease.groupBy({
    by: ["status"],
    _count: true,
  });
  const active = await prisma.abilityCatalogRelease.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, releaseKey: true, wowBuild: true },
  });
  const open = batches.filter((b) => b.status === "OPEN");
  const current = open[0] ?? null;
  const items = current?.items ?? [];
  const racialNew = items.filter(
    (i) => i.kind === "NEW_ABILITY_CANDIDATE" && !i.classSlug && Array.isArray(i.raceSlugs) && i.raceSlugs.length > 0,
  );
  console.log(
    JSON.stringify(
      {
        label,
        batchCounts: {
          total: batches.length,
          OPEN: batches.filter((b) => b.status === "OPEN").length,
          SUPERSEDED: batches.filter((b) => b.status === "SUPERSEDED").length,
          REVIEWED: batches.filter((b) => b.status === "REVIEWED").length,
          zeroDecision: batches.filter((b) => b.items.every((i) => i.decisionAction == null)).length,
          decided: batches.filter((b) => b.items.some((i) => i.decisionAction != null)).length,
          items: batches.reduce((n, b) => n + b.items.length, 0),
        },
        releasesByStatus: Object.fromEntries(releases.map((r) => [r.status, r._count])),
        active,
        currentBatch: current
          ? {
              id: current.id,
              status: current.status,
              reportDigest: current.reportDigest,
              reviewPlanDigest: current.reviewPlanDigest,
              wowBuild: current.wowBuild,
              simcRevision: current.simcRevision,
              itemCount: items.length,
              racialNew: racialNew.length,
              arcaneTorrent: items.filter((i) => /arcane torrent/i.test(i.name)).length,
              giftOfTheNaaru: items.filter((i) => /gift of the naaru/i.test(i.name)).length,
              bloodFuryNew: racialNew.filter((i) => /blood fury/i.test(i.name)).length,
            }
          : null,
        openBatchIds: open.map((b) => b.id),
      },
      null,
      2,
    ),
  );
  return current;
}

await summarize("before-refresh");

const orch = new AbilityCatalogRefreshOrchestrationService(prisma, env);
const audit = {
  actorType: "system" as const,
  sessionSecret: env.SESSION_SECRET,
  userId: null,
};

const first = await orch.runRefresh(audit);
console.log(
  JSON.stringify(
    {
      firstRefresh: {
        batchId: first.batchId,
        created: first.created,
        reviewRequired: first.reviewRequired,
      },
    },
    null,
    2,
  ),
);
const afterFirst = await summarize("after-first-refresh");

const second = await orch.runRefresh(audit);
console.log(
  JSON.stringify(
    {
      secondRefresh: {
        batchId: second.batchId,
        created: second.created,
        sameBatch: second.batchId === first.batchId,
        reviewRequired: second.reviewRequired,
      },
    },
    null,
    2,
  ),
);
await summarize("after-second-refresh");

await prisma.$disconnect();
