#!/usr/bin/env node
/**
 * Export portable provider-data corpus (manifest.json + latest.json.gz).
 *
 * Manual CLI export is allowed from any APP_ENV / PROVIDER_DATA_ROLE for
 * debugging and one-shot staging→prod migration. Automatic nightly export
 * requires collector role (see automatic-schedulers).
 *
 * Usage:
 *   pnpm provider-data:export
 *   pnpm provider-data:export -- --dir /tmp/provider-data
 */
import { loadEnv } from "@mplus/config";
import { createWorkerContainer } from "../container.js";
import { exportProviderDataBundle } from "./export-bundle.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const dirFlagIdx = process.argv.indexOf("--dir");
  const outputDir =
    dirFlagIdx >= 0 && process.argv[dirFlagIdx + 1]
      ? process.argv[dirFlagIdx + 1]!
      : env.PROVIDER_DATA_DIR;

  const container = createWorkerContainer(env);
  try {
    const result = await exportProviderDataBundle({
      prisma: container.prisma,
      outputDir,
      sourceEnvironment: env.APP_ENV,
    });
    console.log(
      JSON.stringify(
        {
          ok: true,
          outputDir,
          contentHash: result.contentHash,
          manifestPath: result.manifestPath,
          payloadPath: result.payloadPath,
          counts: result.counts,
          providerDataRole: env.PROVIDER_DATA_ROLE,
          note:
            env.PROVIDER_DATA_ROLE === "collector"
              ? "collector role — automatic export schedule may also run"
              : "manual export (automatic export only on collector)",
        },
        null,
        2,
      ),
    );
  } finally {
    await container.prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
