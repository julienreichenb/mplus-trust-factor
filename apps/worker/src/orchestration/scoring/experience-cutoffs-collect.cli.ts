/**
 * Collect closed Mythic+ season cutoffs into the offline Experience catalog.
 *
 *   pnpm experience:cutoffs:collect
 *   pnpm experience:cutoffs:collect -- --dry-run
 *   pnpm experience:cutoffs:collect -- --region EU --season season-tww-3
 */
import { loadEnv } from "@mplus/config";
import { createWorkerContainer } from "../../container.js";
import {
  collectExperienceSeasonCutoffs,
  formatCollectExperienceCutoffsSummary,
  type CollectExperienceCutoffsOptions,
} from "./experience-cutoffs-collect.js";
import type { ExperienceCutoffRegionCode } from "@mplus/database";

function parseArgs(argv: string[]): CollectExperienceCutoffsOptions {
  const regions: ExperienceCutoffRegionCode[] = [];
  let seasonSlug: string | undefined;
  let dryRun = false;
  let fresh = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--fresh") {
      fresh = true;
    } else if (arg === "--region" && argv[i + 1]) {
      regions.push(argv[++i]!.toUpperCase() as ExperienceCutoffRegionCode);
    } else if (arg === "--season" && argv[i + 1]) {
      seasonSlug = argv[++i];
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: experience:cutoffs:collect [--dry-run] [--fresh] [--region CODE]... [--season SLUG]",
      );
      process.exit(0);
    }
  }
  return {
    dryRun,
    fresh,
    seasonSlug,
    regions: regions.length ? regions : undefined,
  };
}

async function main(): Promise<void> {
  const env = loadEnv();
  const options = parseArgs(process.argv.slice(2).filter((a) => a !== "--"));
  const container = createWorkerContainer(env);
  const now = new Date().toISOString();
  try {
    const result = await collectExperienceSeasonCutoffs({
      raiderIo: container.providers.raiderio,
      ctx: {
        region: "EU",
        requestId: `experience-cutoffs-collect-${now}`,
        correlationId: null,
        forceRefresh: true,
        now,
      },
      options,
    });
    console.log(formatCollectExperienceCutoffsSummary(result));
    process.exit(result.failed > 0 ? 1 : 0);
  } finally {
    await container.prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
