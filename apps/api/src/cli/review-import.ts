/**
 * Import a PINNED shadow report into durable AbilityCatalogReviewBatch rows.
 *
 *   pnpm ability-catalog:review:import -- --report <report.json> [--simc <simc.json>] [--blizzard <blizzard.json>] [--designate-baseline] [--json]
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, resetEnvCache } from "@mplus/config";
import { createPrismaClient } from "@mplus/database";
import type { CatalogRefreshReport, TopologyClassificationLike } from "@mplus/abilities";
import { AbilityCatalogReviewService } from "../services/ability-catalog-review-service.js";

function arg(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name);
  return idx >= 0 ? argv[idx + 1] : undefined;
}

function printUsage(): never {
  console.error(`Usage:
  pnpm ability-catalog:review:import -- --report <report.json> [--simc <simc.json>] [--blizzard <blizzard.json>] [--designate-baseline] [--json]

Imports a PINNED shadow report into AbilityCatalogReviewBatch (idempotent by report digest).
Does not publish or mutate RETAIL_ABILITY_CATALOG.`);
  process.exit(2);
}

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

function findWorkspaceRoot(start: string): string {
  let dir = start;
  for (;;) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

function resolvePath(p: string): string {
  if (resolve(p) === p) return p;
  return resolve(findWorkspaceRoot(process.cwd()), p);
}

const here = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(here, "../../..");
loadDotEnvFile(resolve(root, ".env"));
resetEnvCache();

const argv = process.argv.slice(2);
const reportPath = arg(argv, "--report");
const simcPath = arg(argv, "--simc");
const blizzardPath = arg(argv, "--blizzard");
const designateBaseline = argv.includes("--designate-baseline");
const json = argv.includes("--json");

if (!reportPath) {
  printUsage();
}

const reportAbs = resolvePath(reportPath);
const reportBytes = readFileSync(reportAbs);
const reportJson = JSON.parse(reportBytes.toString("utf8")) as CatalogRefreshReport & {
  topologyClassification?: TopologyClassificationLike;
};

if (reportJson.datasetKind !== "PINNED") {
  console.error(
    `ERROR: review import requires datasetKind=PINNED (got ${String(reportJson.datasetKind)})`,
  );
  process.exit(1);
}

const { topologyClassification, ...reportRest } = reportJson;
const report = reportRest as CatalogRefreshReport;

const simcBytes = simcPath ? readFileSync(resolvePath(simcPath)) : null;
const blizzardBytes = blizzardPath ? readFileSync(resolvePath(blizzardPath)) : null;

const env = loadEnv();
const prisma = createPrismaClient(env.DATABASE_URL);
const service = new AbilityCatalogReviewService(prisma);

try {
  const result = await service.importPinnedReport(
    {
      report,
      reportBytes,
      topologyClassification,
      simcBytes,
      blizzardBytes,
      designateBaseline,
    },
    {
      actorType: "system",
      sessionSecret: env.SESSION_SECRET,
      userId: null,
    },
  );

  const payload = {
    created: result.created,
    rebuilt: result.rebuilt,
    batchId: result.batch.id,
    reportDigest: result.batch.reportDigest,
    reviewPlanDigest: result.batch.reviewPlanDigest,
    itemCounts: result.batch.summaryCounts,
    decisionCounts: result.batch.decisionCounts,
    baselineId: result.baselineId,
  };

  if (json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(
      [
        result.created
          ? "Imported new review batch"
          : result.rebuilt
            ? "Rebuilt undecided review batch with current plan"
            : "Idempotent hit — existing review batch",
        `batchId=${payload.batchId}`,
        `reportDigest=${payload.reportDigest}`,
        `reviewPlanDigest=${payload.reviewPlanDigest}`,
        `summary=${JSON.stringify(payload.itemCounts)}`,
        result.baselineId ? `baselineId=${result.baselineId}` : "baseline=skipped",
      ].join("\n"),
    );
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ERROR: ${message}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
