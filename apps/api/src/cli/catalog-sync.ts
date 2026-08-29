/**
 * Ability Catalog source sync — standalone entry (CLI / one-shot container).
 *
 * Runs SimC + Blizzard extract → refresh/import into pending classification state.
 * NEVER publishes or activates a catalog release.
 *
 *   pnpm ability-catalog:sync
 *   docker compose … run --rm catalog-sync
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, resetEnvCache } from "@mplus/config";
import { createPrismaClient } from "@mplus/database";
import { AbilityCatalogRefreshOrchestrationService } from "../services/ability-catalog-refresh-orchestration-service.js";
import { AbilityCatalogPublishService } from "../services/ability-catalog-publish-service.js";
import { HttpError } from "../errors.js";

const BUNDLED_LINUX_SIMC = "/usr/local/bin/simc";

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

function fail(code: string, message: string): never {
  console.error(`[catalog-sync] FAIL ${code}: ${message}`);
  process.exit(1);
}

function resolveSimcPath(override: string | undefined): string {
  const candidate = (override ?? "").trim() || BUNDLED_LINUX_SIMC;
  if (!existsSync(candidate)) {
    fail(
      "SIMC_NOT_CONFIGURED",
      `SimulationCraft binary not found at ${candidate}. Set ABILITY_CATALOG_SIMC_BIN or use the catalog-sync image.`,
    );
  }
  return candidate;
}

async function main(): Promise<void> {
  const started = Date.now();
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
  loadDotEnvFile(resolve(root, ".env"));
  resetEnvCache();

  let env;
  try {
    env = loadEnv();
  } catch (error) {
    fail(
      "CONFIG_INVALID",
      error instanceof Error ? error.message : "Failed to load environment configuration",
    );
  }

  if (!env.DATABASE_URL) {
    fail("CONFIG_INVALID", "DATABASE_URL is required");
  }
  if (!env.BLIZZARD_CLIENT_ID || !env.BLIZZARD_CLIENT_SECRET) {
    fail(
      "BLIZZARD_NOT_CONFIGURED",
      "BLIZZARD_CLIENT_ID and BLIZZARD_CLIENT_SECRET are required for catalog source sync",
    );
  }

  const simcPath = resolveSimcPath(env.ABILITY_CATALOG_SIMC_BIN);
  console.log(`[catalog-sync] SimC binary: ${simcPath}`);

  const prisma = createPrismaClient(env.DATABASE_URL);
  const audit = {
    userId: null as string | null,
    actorType: "system" as const,
    sessionSecret: env.SESSION_SECRET,
  };

  console.log("[catalog-sync] Starting source synchronization (SimC + Blizzard → import)");
  console.log("[catalog-sync] ACTIVE release will NOT be changed");

  try {
    const orchestration = new AbilityCatalogRefreshOrchestrationService(prisma, env);
    const outcome = await orchestration.runRefresh(audit);
    const publish = new AbilityCatalogPublishService(prisma);
    const publishStatus = await publish.getPublishStatus();

    const simcIdentity = outcome.result.report.snapshots.find((s) => s.source === "SIMULATIONCRAFT");
    const blizzardIdentity = outcome.result.report.snapshots.find((s) => s.source === "BLIZZARD");
    const unclassified = publishStatus.pending.unclassifiedCandidateCount;
    const durationMs = Date.now() - started;

    console.log(
      JSON.stringify(
        {
          status: "ok",
          activeUnchanged: outcome.activeUnchanged,
          published: false,
          batchId: outcome.batchId,
          batchCreated: outcome.created,
          reviewRequired: outcome.reviewRequired,
          simcRevision:
            simcIdentity?.sourceRevision ??
            outcome.result.simcFile.binaryIdentity?.gitRevision ??
            null,
          wowBuild:
            simcIdentity?.validFromBuild ??
            outcome.result.simcFile.binaryIdentity?.wowBuild ??
            null,
          blizzardRevision: blizzardIdentity?.sourceRevision ?? null,
          unclassifiedCandidateCount: unclassified,
          summary: outcome.result.summary,
          durationMs,
        },
        null,
        2,
      ),
    );
    console.log(
      `[catalog-sync] Complete in ${durationMs}ms — classify pending work in /admin/ability-catalog, then Publish`,
    );
  } catch (error) {
    if (error instanceof HttpError) {
      fail(error.code, error.message);
    }
    fail(
      "SYNC_FAILED",
      error instanceof Error ? error.message : "Catalog source sync failed",
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  fail("SYNC_FAILED", error instanceof Error ? error.message : String(error));
});
