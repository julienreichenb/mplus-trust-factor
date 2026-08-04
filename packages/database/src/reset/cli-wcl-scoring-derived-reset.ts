#!/usr/bin/env tsx
/**
 * Guarded local reset of WCL / scoring-derived data.
 *
 * Default = DRY-RUN (no mutations).
 *
 *   pnpm db:reset:wcl-scoring-derived -- --confirm=RESET_LOCAL_WCL_SCORING_DATA
 *   pnpm db:reset:wcl-scoring-derived -- --confirm=RESET_LOCAL_WCL_SCORING_DATA --execute
 *
 * Never run against production/staging/remote databases.
 */
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { Redis } from "ioredis";
import {
  assertWclScoringDerivedResetAllowed,
  formatWclScoringDerivedResetGuardFailure,
  WCL_SCORING_DERIVED_RESET_CONFIRMATION_TOKEN,
} from "./wcl-scoring-derived-reset-guard.js";
import {
  buildWclScoringDerivedResetPlan,
  executeWclScoringDerivedReset,
  formatPlanTerminalSummary,
  type RedisScanner,
} from "./wcl-scoring-derived-reset.js";

function parseArgs(argv: string[]) {
  const out = {
    confirm: null as string | null,
    execute: false,
  };
  for (const arg of argv) {
    if (arg.startsWith("--confirm=")) out.confirm = arg.slice("--confirm=".length);
    else if (arg === "--execute") out.execute = true;
  }
  return out;
}

async function connectRedis(redisUrl: string): Promise<RedisScanner | null> {
  try {
    const client = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2_000,
      lazyConnect: true,
    });
    await client.connect();
    return {
      keys: (pattern) => client.keys(pattern),
      del: (...keys) => (keys.length === 0 ? Promise.resolve(0) : client.del(...keys)),
      quit: async () => {
        await client.quit();
      },
    };
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const gate = assertWclScoringDerivedResetAllowed({
    confirmationToken: args.confirm ?? undefined,
    databaseUrl: process.env.DATABASE_URL,
    redisUrl: process.env.REDIS_URL,
    rawArtifactsDir: process.env.RAW_ARTIFACTS_DIR ?? "./data/raw-artifacts",
    appEnv: process.env.APP_ENV,
  });

  if (!gate.ok) {
    console.error(formatWclScoringDerivedResetGuardFailure(gate));
    process.exitCode = 2;
    return;
  }

  const prisma = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL } },
  });
  const redis = await connectRedis(process.env.REDIS_URL ?? "");

  try {
    if (args.execute && redis == null) {
      console.error(
        "Refusing --execute: could not connect to local Redis (namespace-scoped cleanup required).",
      );
      process.exitCode = 2;
      return;
    }

    const plan = await buildWclScoringDerivedResetPlan({
      prisma,
      gate,
      execute: args.execute,
      redis,
      cwd: process.cwd(),
    });

    console.log(formatPlanTerminalSummary(plan));
    console.log(
      JSON.stringify(
        {
          mode: plan.mode,
          sanitizedDatabase: plan.sanitizedDatabase,
          sanitizedRedis: plan.sanitizedRedis,
          clearTables: plan.clearTables,
          retainTables: plan.retainTables.filter((t) => t.rowCount != null),
          importantRetainTables: plan.importantRetainTables,
          redis: plan.redis,
          artifacts: plan.artifacts,
          activeWriters: plan.activeWriters,
          warnings: plan.warnings,
          blockedConditions: plan.blockedConditions,
          classificationOk: plan.classificationOk,
          prismaMigrationsApplied: plan.prismaMigrationsApplied,
          confirmationTokenRequired: WCL_SCORING_DERIVED_RESET_CONFIRMATION_TOKEN,
          resolvedArtifactsDir: path.resolve(plan.artifacts.resolvedRootDir),
        },
        null,
        2,
      ),
    );

    if (!args.execute) {
      console.log(
        "Dry-run complete. Re-run with --execute to mutate (still requires confirmation token).",
      );
      if (plan.blockedConditions.length > 0) {
        console.error("Execute would be refused due to blocked conditions above.");
        process.exitCode = 2;
      }
      return;
    }

    if (plan.blockedConditions.length > 0) {
      console.error("Refusing --execute due to blocked conditions.");
      process.exitCode = 2;
      return;
    }

    const result = await executeWclScoringDerivedReset({ prisma, plan, redis });
    console.log(
      JSON.stringify(
        {
          executed: true,
          clearedTables: result.clearedTables,
          retainedTables: result.retainedTables,
          redisKeysDeleted: result.redisKeysDeleted,
          artifactFilesRemoved: result.artifactFilesRemoved,
          danglingArtifactReferences: result.danglingArtifactReferences,
          migrationsStillApplied: result.migrationsStillApplied,
        },
        null,
        2,
      ),
    );
    console.log("Execute completed. Database is ready for a fresh Wallidrixe canary.");
  } finally {
    await prisma.$disconnect();
    if (redis) await redis.quit().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
