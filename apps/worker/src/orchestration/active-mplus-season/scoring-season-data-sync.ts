import type { Logger } from "@mplus/observability";
import type { PrismaClient } from "@mplus/database";
import { peekEffectiveScoringSeasonRowGlobal } from "./effective-season-peek.js";
import { resolveScoringCatalogDiscoverer } from "./effective-scoring-season.js";
import { synchronizeScoringSeasonData } from "./synchronize-scoring-season-data.js";
import { withSharedAddonIngestSession } from "../key-distribution-refresh.js";

/** @deprecated Prefer cron registration via `SCORING_SEASON_DATA_SYNC_CRON_PATTERN`. */
export const SCORING_SEASON_DATA_SYNC_CADENCE_MS = 24 * 60 * 60 * 1000;
export {
  SCORING_SEASON_DATA_SYNC_SCHEDULER_ID,
  SCORING_SEASON_DATA_SYNC_CRON_PATTERN,
  SCORING_SEASON_DATA_SYNC_CRON_TZ,
} from "../../scheduling/automatic-schedulers.js";

export async function runScheduledScoringSeasonDataSync(input: {
  prisma: PrismaClient;
  logger: Logger;
  blizzardSeasonId?: number;
  warcraftlogs?: Parameters<typeof resolveScoringCatalogDiscoverer>[0]["warcraftlogs"];
  blizzard?: Parameters<typeof synchronizeScoringSeasonData>[0]["blizzard"];
  providerMode?: string;
  fetchImpl?: typeof fetch;
}): Promise<{
  blizzardSeasonId: number | null;
  skipped: boolean;
  reason: string | null;
  downloads: number;
  regions: Awaited<ReturnType<typeof synchronizeScoringSeasonData>>["regions"] | null;
}> {
  const peek = await peekEffectiveScoringSeasonRowGlobal(input.prisma);
  const blizzardSeasonId = input.blizzardSeasonId ?? peek?.blizzardSeasonId ?? null;
  if (blizzardSeasonId == null) {
    return {
      blizzardSeasonId: null,
      skipped: true,
      reason: "NO_EFFECTIVE_SEASON",
      downloads: 0,
      regions: null,
    };
  }

  if (inFlightScoringSeasonDataSync) {
    input.logger.info(
      { event: "season_data_sync_joined", blizzardSeasonId },
      "joining in-flight scoring season data sync",
    );
    return inFlightScoringSeasonDataSync;
  }

  inFlightScoringSeasonDataSync = executeScheduledScoringSeasonDataSync({
    ...input,
    blizzardSeasonId,
    selectionMode: peek?.selectionMode ?? "AUTO",
  }).finally(() => {
    inFlightScoringSeasonDataSync = null;
  });
  return inFlightScoringSeasonDataSync;
}

let inFlightScoringSeasonDataSync: Promise<{
  blizzardSeasonId: number | null;
  skipped: boolean;
  reason: string | null;
  downloads: number;
  regions: Awaited<ReturnType<typeof synchronizeScoringSeasonData>>["regions"] | null;
}> | null = null;

async function executeScheduledScoringSeasonDataSync(input: {
  prisma: PrismaClient;
  logger: Logger;
  blizzardSeasonId: number;
  selectionMode: "AUTO" | "PINNED";
  warcraftlogs?: Parameters<typeof resolveScoringCatalogDiscoverer>[0]["warcraftlogs"];
  blizzard?: Parameters<typeof synchronizeScoringSeasonData>[0]["blizzard"];
  providerMode?: string;
  fetchImpl?: typeof fetch;
}): Promise<{
  blizzardSeasonId: number | null;
  skipped: boolean;
  reason: string | null;
  downloads: number;
  regions: Awaited<ReturnType<typeof synchronizeScoringSeasonData>>["regions"] | null;
}> {
  const discoverer =
    input.selectionMode === "AUTO" && input.warcraftlogs
      ? resolveScoringCatalogDiscoverer({
          warcraftlogs: input.warcraftlogs,
          providerMode: input.providerMode,
        })
      : undefined;

  return withSharedAddonIngestSession(
    { prisma: input.prisma, logger: input.logger, fetchImpl: input.fetchImpl },
    async (session) => {
      const sync = await synchronizeScoringSeasonData({
        prisma: input.prisma,
        logger: input.logger,
        blizzardSeasonId: input.blizzardSeasonId,
        selectionMode: input.selectionMode,
        discoverActiveMplusCatalog: discoverer,
        providerMode: input.providerMode,
        blizzard: input.blizzard,
        requestDistributionRefresh: async ({ seasonId, regionCode }) => {
          await session.refreshRegion({ seasonId, regionCode });
        },
      });
      return {
        blizzardSeasonId: input.blizzardSeasonId,
        skipped: false,
        reason: null,
        downloads: session.downloadCount(),
        regions: sync.regions,
      };
    },
  );
}
