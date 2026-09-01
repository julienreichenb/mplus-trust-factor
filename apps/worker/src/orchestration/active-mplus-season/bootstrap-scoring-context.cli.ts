/**
 * Local bootstrap helper: prepare current scoring season catalog + Raider.IO Key
 * distributions. Does not enqueue relevant-character discovery or WCL drain work.
 *
 * Usage: `pnpm --filter @mplus/worker run scoring:bootstrap-context`
 */
import { loadEnv } from "@mplus/config";
import { createLogger } from "@mplus/observability";
import { createWorkerContainer } from "../../container.js";
import {
  bootstrapSeasonAuthorityForRegions,
  listPersistedRegionsForAuthority,
} from "../season-authority.js";
import { runScheduledScoringSeasonDataSync } from "./scoring-season-data-sync.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger({ level: env.LOG_LEVEL, name: "bootstrap-scoring-context" });
  const container = createWorkerContainer(env);

  try {
    const regions = await listPersistedRegionsForAuthority(container.prisma);
    if (regions.length > 0) {
      logger.info(
        { event: "bootstrap_scoring_context_season_authority", regionCount: regions.length },
        "bootstrapping season authority for regions",
      );
      await bootstrapSeasonAuthorityForRegions(
        {
          prisma: container.prisma,
          blizzard: container.providers.blizzard,
          logger,
        },
        regions,
      );
    }

    logger.info(
      { event: "bootstrap_scoring_context_sync_start", providerMode: env.PROVIDER_MODE },
      "synchronizing current scoring season data and Key distributions",
    );
    const result = await runScheduledScoringSeasonDataSync({
      prisma: container.prisma,
      logger,
      warcraftlogs: container.providers.warcraftlogs,
      blizzard: container.providers.blizzard,
      providerMode: env.PROVIDER_MODE,
    });

    if (result.skipped) {
      logger.warn(
        {
          event: "bootstrap_scoring_context_skipped",
          reason: result.reason,
        },
        "scoring context bootstrap skipped — no effective season (seed may not have created one yet)",
      );
      return;
    }

    logger.info(
      {
        event: "bootstrap_scoring_context_sync_complete",
        blizzardSeasonId: result.blizzardSeasonId,
        downloads: result.downloads,
        regions: result.regions?.map((r) => ({
          regionCode: r.regionCode,
          ok: r.ok,
          seasonId: r.seasonId,
          catalogReadyAfter: r.result?.catalogReadyAfter ?? null,
          distributionRequested: r.result?.distributionRequested ?? false,
          distributionError: r.result?.distributionError ?? r.error,
        })),
      },
      "scoring context bootstrap complete",
    );
  } finally {
    await container.prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(
    "bootstrap-scoring-context failed:",
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
