#!/usr/bin/env tsx
/**
 * Guarded identity-data reset (local development + deployed test).
 *
 * Default = DRY-RUN (no mutations). Significantly more destructive than
 * db:reset:wcl-scoring-derived — clears ALL characters and all users except
 * one explicitly retained administrator + Battle.net account.
 *
 * Local dry-run:
 *   pnpm db:reset:identity-data -- `
 *     --target=local-development `
 *     --keep-user-id=<UUID> `
 *     --keep-bnet-account-id=<UUID> `
 *     --confirm=RESET_LOCAL_IDENTITY_DATA
 *
 * Deployed-test dry-run (PowerShell):
 *   $env:MPLUS_CLEANUP_TARGET="deployed-test"
 *   $env:MPLUS_IDENTITY_RESET_ENVIRONMENT_ID="mplus-test"
 *   pnpm db:reset:identity-data -- `
 *     --target=deployed-test `
 *     --expected-database-name=mplus_trust_test `
 *     --keep-user-id=<UUID> `
 *     --keep-bnet-account-id=<UUID> `
 *     --confirm=RESET_DEPLOYED_TEST_IDENTITY_DATA
 *
 * Production identity reset is categorically forbidden.
 */
import { fileURLToPath } from "node:url";
import path from "node:path";
import { findMonorepoConfigRoot } from "@mplus/artifact-store";
import { PrismaClient } from "@prisma/client";
import { Redis } from "ioredis";
import {
  assertIdentityDataResetAllowed,
  formatIdentityDataResetGuardFailure,
} from "./identity-data-reset-guard.js";
import {
  buildIdentityDataResetPlan,
  executeIdentityDataReset,
  formatIdentityPlanTerminalSummary,
  type ExtendedRedisScanner,
} from "./identity-data-reset.js";

function parseArgs(argv: string[]) {
  const out = {
    target: null as string | null,
    keepUserId: null as string | null,
    keepBnetAccountId: null as string | null,
    confirm: null as string | null,
    expectedDatabaseName: null as string | null,
    execute: false,
  };
  for (const arg of argv) {
    if (arg.startsWith("--target=")) out.target = arg.slice("--target=".length);
    else if (arg.startsWith("--keep-user-id="))
      out.keepUserId = arg.slice("--keep-user-id=".length);
    else if (arg.startsWith("--keep-bnet-account-id="))
      out.keepBnetAccountId = arg.slice("--keep-bnet-account-id=".length);
    else if (arg.startsWith("--confirm=")) out.confirm = arg.slice("--confirm=".length);
    else if (arg.startsWith("--expected-database-name="))
      out.expectedDatabaseName = arg.slice("--expected-database-name=".length);
    else if (arg === "--execute") out.execute = true;
  }
  return out;
}

function resolveConfigRoot(): string | null {
  const fromCwd = findMonorepoConfigRoot(process.cwd());
  if (fromCwd) return fromCwd;
  return findMonorepoConfigRoot(path.dirname(fileURLToPath(import.meta.url)));
}

async function connectRedis(redisUrl: string): Promise<ExtendedRedisScanner | null> {
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
      llen: (key) => client.llen(key),
      exists: (...keys) => (keys.length === 0 ? Promise.resolve(0) : client.exists(...keys)),
      set: (key, value, mode, ttl, nx) => {
        if (mode === "EX" && typeof ttl === "number" && nx === "NX") {
          return client.set(key, value, "EX", ttl, "NX");
        }
        return client.set(key, value);
      },
      get: (key) => client.get(key),
      eval: (script, numKeys, ...args) =>
        client.eval(script, numKeys, ...args) as Promise<unknown>,
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
  const configRoot = resolveConfigRoot();
  const gate = assertIdentityDataResetAllowed({
    target: args.target,
    keepUserId: args.keepUserId,
    keepBnetAccountId: args.keepBnetAccountId,
    confirmationToken: args.confirm,
    expectedDatabaseName: args.expectedDatabaseName,
    execute: args.execute,
    databaseUrl: process.env.DATABASE_URL,
    redisUrl: process.env.REDIS_URL,
    rawArtifactsDir: process.env.RAW_ARTIFACTS_DIR,
    configRoot,
    appEnv: process.env.APP_ENV,
    nodeEnv: process.env.NODE_ENV,
  });

  if (!gate.ok) {
    console.error(formatIdentityDataResetGuardFailure(gate));
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
        "Refusing --execute: could not connect to Redis (live-writer probe + lock + namespace cleanup required).",
      );
      process.exitCode = 2;
      return;
    }

    const plan = await buildIdentityDataResetPlan({
      prisma,
      gate,
      execute: args.execute,
      redis,
    });

    console.log(formatIdentityPlanTerminalSummary(plan));
    console.log(
      JSON.stringify(
        {
          mode: plan.mode,
          target: plan.target,
          sanitizedDatabase: plan.sanitizedDatabase,
          sanitizedRedis: plan.sanitizedRedis,
          expectedDatabaseName: plan.expectedDatabaseName,
          deployedTestClassification: plan.deployedTestClassification,
          artifactBackend: plan.artifactBackend,
          retainedUser: plan.retainedUser,
          retainedBattleNetAccount: plan.retainedBattleNetAccount,
          rowCountsBefore: plan.rowCountsBefore,
          plannedTruncations: plan.plannedTruncations,
          plannedSelectiveDeletes: plan.plannedSelectiveDeletes,
          plannedStaticRetain: plan.plannedStaticRetain,
          foreignKeyPlan: plan.foreignKeyPlan,
          redis: plan.redis,
          artifacts: {
            backend: plan.artifacts.backend,
            configuredDir: plan.artifacts.configuredDir,
            resolvedRootDir: plan.artifacts.resolvedRootDir,
            fileCount: plan.artifacts.fileCount,
            totalBytes: plan.artifacts.totalBytes,
          },
          activeWriters: plan.activeWriters,
          maintenanceAssertion: plan.maintenanceAssertion,
          warnings: plan.warnings,
          blockedConditions: plan.blockedConditions,
          classificationOk: plan.classificationOk,
          prismaMigrationsApplied: plan.prismaMigrationsApplied,
          confirmationTokenRequired: plan.confirmationTokenRequired,
          postconditions: plan.postconditions,
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

    const result = await executeIdentityDataReset({
      prisma,
      plan,
      redis,
      artifactsDir: plan.artifacts.resolvedRootDir,
    });

    console.log(
      JSON.stringify(
        {
          executed: true,
          oauthFingerprintUnchanged: result.oauthFingerprintUnchanged,
          postconditionFailures: result.postconditionFailures,
          externalCleanup: result.externalCleanup,
        },
        null,
        2,
      ),
    );

    if (result.postconditionFailures.length > 0) {
      console.error("Postcondition failure — see postconditionFailures.");
      process.exitCode = 4;
      return;
    }
    if (result.externalCleanup.partial) {
      console.error(
        [
          "Database reset committed, but Redis/artifact cleanup was partial.",
          "Re-run the same command with --execute to idempotently finish remaining cleanup.",
          "See externalCleanup for details.",
        ].join("\n"),
      );
      process.exitCode = 3;
      return;
    }
    console.log(
      "Execute completed. Retained admin must re-authenticate and trigger Battle.net character discovery.",
    );
  } finally {
    await prisma.$disconnect();
    if (redis) await redis.quit().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
