#!/usr/bin/env node
/**
 * Operational repair: synchronize Blizzard authoritative season for enabled regions.
 * Idempotent — does not enqueue score refreshes or call WCL.
 *
 * Usage:
 *   pnpm season:sync-authority
 *   pnpm season:sync-authority -- --region EU
 */
import { loadEnv } from "@mplus/config";
import { createWorkerContainer } from "../container.js";
import {
  clearSeasonAuthorityCacheForTests,
  listPersistedRegionsForAuthority,
  repairSeasonAuthority,
} from "./season-authority.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const container = createWorkerContainer(env);
  clearSeasonAuthorityCacheForTests();

  const regionFlagIdx = process.argv.indexOf("--region");
  const onlyRegion =
    regionFlagIdx >= 0 && process.argv[regionFlagIdx + 1]
      ? process.argv[regionFlagIdx + 1]!.toUpperCase()
      : null;

  const regions = await listPersistedRegionsForAuthority(container.prisma);
  const targets = onlyRegion
    ? regions.filter((r) => r.code.toUpperCase() === onlyRegion)
    : regions;

  if (onlyRegion && targets.length === 0) {
    // Ensure region row exists then repair.
    const repaired = await repairSeasonAuthority(
      {
        prisma: container.prisma,
        blizzard: container.providers.blizzard,
        logger: container.logger,
      },
      onlyRegion,
    );
    console.log(
      JSON.stringify(
        {
          region: repaired.region,
          previous: repaired.previous,
          current: {
            blizzardSeasonId: repaired.current.blizzardSeasonId,
            slug: repaired.current.slug,
            authoritySource: repaired.current.authoritySource,
            authorityVerifiedAt: repaired.current.authorityVerifiedAt.toISOString(),
          },
          changed: repaired.changed,
        },
        null,
        2,
      ),
    );
    await container.prisma.$disconnect();
    return;
  }

  if (targets.length === 0) {
    console.error("No regions found in database. Seed regions first.");
    process.exitCode = 1;
    await container.prisma.$disconnect();
    return;
  }

  const reports = [];
  for (const region of targets) {
    const repaired = await repairSeasonAuthority(
      {
        prisma: container.prisma,
        blizzard: container.providers.blizzard,
        logger: container.logger,
      },
      region.code,
    );
    reports.push({
      region: repaired.region,
      previous: repaired.previous,
      current: {
        blizzardSeasonId: repaired.current.blizzardSeasonId,
        slug: repaired.current.slug,
        authoritySource: repaired.current.authoritySource,
        authorityVerifiedAt: repaired.current.authorityVerifiedAt.toISOString(),
      },
      changed: repaired.changed,
    });
  }

  console.log(JSON.stringify({ regions: reports }, null, 2));
  await container.prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
