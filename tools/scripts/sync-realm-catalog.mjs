#!/usr/bin/env node
/**
 * Synchronize the retail WoW realm catalog from Blizzard Game Data APIs.
 *
 * Usage:
 *   pnpm realms:sync
 *   pnpm realms:sync -- --region EU
 *   pnpm realms:sync -- --region EU --region US --force-details
 */
import { loadEnv } from "@mplus/config";
import { createLogger } from "@mplus/observability";
import { createWorkerContainer, syncRealmCatalog } from "@mplus/worker";

function parseArgs(argv) {
  const regions = [];
  let forceDetails = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--region" && argv[i + 1]) {
      regions.push(argv[++i]);
    } else if (arg === "--force-details") {
      forceDetails = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: realms:sync [--region CODE]... [--force-details]`);
      process.exit(0);
    }
  }
  return { regions, forceDetails };
}

const env = loadEnv();
const logger = createLogger({ level: env.LOG_LEVEL, name: "realms-sync" });
const { regions, forceDetails } = parseArgs(process.argv.slice(2));
const container = createWorkerContainer(env);

try {
  const results = await syncRealmCatalog(
    {
      blizzard: container.providers.blizzard,
      realms: container.repositories.realm,
      logger,
      detailConcurrency: env.REALM_CATALOG_DETAIL_CONCURRENCY,
    },
    {
      regions: regions.length ? regions : undefined,
      forceDetails,
      requestedAt: new Date().toISOString(),
    },
  );
  console.log(JSON.stringify({ ok: true, results }, null, 2));
  const failed = results.some((r) => r.errors.length > 0 && r.minimallyUpserted === 0);
  process.exit(failed ? 1 : 0);
} catch (error) {
  logger.error({ err: error }, "realm catalog sync failed");
  process.exit(1);
} finally {
  await container.prisma.$disconnect();
}
