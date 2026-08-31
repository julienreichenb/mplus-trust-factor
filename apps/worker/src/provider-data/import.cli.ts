#!/usr/bin/env node
/**
 * Import portable provider-data corpus from PROVIDER_DATA_DIR (or --dir).
 *
 * Idempotent by contentHash. Safe for consumer role and local testing.
 *
 * Usage:
 *   pnpm provider-data:import
 *   pnpm provider-data:import -- --dir /tmp/provider-data
 */
import { loadEnv } from "@mplus/config";
import { createWorkerContainer } from "../container.js";
import { importProviderDataBundle, ProviderDataImportError } from "./import-bundle.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const dirFlagIdx = process.argv.indexOf("--dir");
  const dir =
    dirFlagIdx >= 0 && process.argv[dirFlagIdx + 1]
      ? process.argv[dirFlagIdx + 1]!
      : env.PROVIDER_DATA_DIR;

  const container = createWorkerContainer(env);
  try {
    const result = await importProviderDataBundle({
      prisma: container.prisma,
      dir,
    });
    console.log(
      JSON.stringify(
        {
          ok: true,
          dir,
          contentHash: result.contentHash,
          skippedDuplicate: result.skippedDuplicate,
          stats: result.stats,
          providerDataRole: env.PROVIDER_DATA_ROLE,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    if (error instanceof ProviderDataImportError) {
      console.error(JSON.stringify({ ok: false, code: error.code, message: error.message }));
      process.exitCode = 1;
      return;
    }
    throw error;
  } finally {
    await container.prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
