/**
 * Idempotent Utility Publication v1 backfill / recompute.
 *
 * Identifies characters with persisted wcl-run-evidence-v1 bundles, recomputes
 * Utility from shared evidence (no WCL when cached), and calculates model v6 scores.
 *
 * Usage (from repo root):
 *   pnpm --filter @mplus/worker exec tsx src/utility-publication-backfill.ts
 *
 * Env:
 *   UTILITY_PUBLICATION_MODE=published (required for public Utility)
 *   ACTIVE_SCORE_MODEL_VERSION=6
 *   UTILITY_BACKFILL_LIMIT (optional, default 50)
 *   UTILITY_BACKFILL_DRY_RUN=true (optional — report only)
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, resetEnvCache } from "@mplus/config";
import { createPrismaClient } from "@mplus/database";
import { WCL_RUN_EVIDENCE_ANALYSIS_VERSION } from "@mplus/provider-warcraftlogs";
import { createWorkerContainer } from "./container.js";
import { runRefreshPipeline } from "./orchestration/refresh-pipeline.js";
import { buildRefreshContractHash } from "./orchestration/build-refresh-contract.js";
import { requireEffectiveScoringSeasonRow } from "./orchestration/active-mplus-season/effective-season-peek.js";

function loadDotEnvFile(path: string): void {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(here, "../../..");
loadDotEnvFile(resolve(repoRoot, ".env"));
loadDotEnvFile(resolve(here, "../.env"));

process.env.UTILITY_PUBLICATION_MODE = process.env.UTILITY_PUBLICATION_MODE ?? "published";
process.env.ACTIVE_SCORE_MODEL_VERSION = process.env.ACTIVE_SCORE_MODEL_VERSION ?? "6";
resetEnvCache();

const env = loadEnv();
const dryRun = ["1", "true", "yes"].includes(
  (process.env.UTILITY_BACKFILL_DRY_RUN ?? "false").toLowerCase(),
);
const limit = Math.max(1, Number(process.env.UTILITY_BACKFILL_LIMIT ?? "50") || 50);

const prisma = createPrismaClient(env.DATABASE_URL);
const worker = createWorkerContainer(env, { prisma });

const evidenceRows = await prisma.runAnalysis.findMany({
  where: { analysisVersion: WCL_RUN_EVIDENCE_ANALYSIS_VERSION },
  distinct: ["characterId"],
  take: limit,
  orderBy: { analyzedAt: "desc" },
  select: { characterId: true, runId: true, analyzedAt: true },
});

const summary = {
  processed: 0,
  published: 0,
  skipped: 0,
  failed: 0,
  dryRun,
  limit,
  candidates: evidenceRows.length,
  details: [] as Array<Record<string, unknown>>,
};

for (const row of evidenceRows) {
  summary.processed += 1;
  const character = await prisma.character.findUnique({
    where: { id: row.characterId },
    include: { realm: true, region: true },
  });
  if (!character) {
    summary.skipped += 1;
    summary.details.push({ characterId: row.characterId, status: "skipped_missing_character" });
    continue;
  }

  const identity = {
    region: character.region.code as "EU" | "US" | "KR" | "TW",
    realmSlug: character.realm.slug,
    name: character.displayName,
  };

  if (dryRun) {
    summary.skipped += 1;
    summary.details.push({
      ...identity,
      characterId: character.id,
      status: "dry_run",
    });
    continue;
  }

  try {
    const season = await requireEffectiveScoringSeasonRow(prisma, {
      regionId: character.regionId,
    });
    if (season.wclZoneId == null) {
      throw new Error(
        `Effective scoring season ${season.slug} has no persisted wclZoneId — catalog not ready`,
      );
    }
    const refreshContractHash = buildRefreshContractHash({
      scoringModelKey: env.ACTIVE_SCORE_MODEL_KEY,
      scoringModelVersion: env.ACTIVE_SCORE_MODEL_VERSION,
      activeSeasonId: season.slug,
      zoneId: season.wclZoneId,
      env: process.env,
      allowFixtureZoneDefault: false,
    });
    const result = await runRefreshPipeline(worker, {
      ...identity,
      characterId: character.id,
      priority: "normal",
      forceRefresh: false,
      requestedAt: new Date().toISOString(),
      refreshContractHash,
    });
    const util = result.score?.dimensions?.find((d) => d.dimension === "UTILITY");
    const ranking = (result.score?.explanation as { rankingEligibility?: { eligible?: boolean } } | null)
      ?.rankingEligibility;
    const published = util?.score != null && (util.state === "AVAILABLE" || util.state === "PARTIAL");
    if (published) summary.published += 1;
    else summary.skipped += 1;
    summary.details.push({
      ...identity,
      characterId: character.id,
      jobStatus: result.job.status,
      utilityScore: util?.score ?? null,
      utilityState: util?.state ?? null,
      overallScore: result.score?.overallScore ?? null,
      modelVersion: result.score?.modelVersion ?? null,
      rankingEligible: ranking?.eligible ?? null,
      status: published ? "published" : "skipped_ineligible",
    });
  } catch (err) {
    summary.failed += 1;
    summary.details.push({
      ...identity,
      characterId: character.id,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

console.log(JSON.stringify(summary, null, 2));
await prisma.$disconnect();
