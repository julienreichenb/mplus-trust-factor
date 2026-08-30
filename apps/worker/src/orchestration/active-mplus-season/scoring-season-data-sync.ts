import type { Logger } from "@mplus/observability";
import type { PrismaClient } from "@mplus/database";
import { peekEffectiveScoringSeasonRowGlobal } from "./effective-season-peek.js";
import { resolveScoringCatalogDiscoverer } from "./effective-scoring-season.js";
import { synchronizeScoringSeasonData } from "./synchronize-scoring-season-data.js";
import { withSharedAddonIngestSession } from "../key-distribution-refresh.js";

export const SCORING_SEASON_DATA_SYNC_CADENCE_MS = 24 * 60 * 60 * 1000;
export const SCORING_SEASON_DATA_SYNC_SCHEDULER_ID = "daily-scoring-season-data-sync";

export async function runScheduledScoringSeasonDataSync(input: {
  prisma: PrismaClient;
  logger: Logger;
  blizzardSeasonId?: number;
  warcraftlogs?: Parameters<typeof resolveScoringCatalogDiscoverer>[0]["warcraftlogs"];
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
  const selectionMode = peek?.selectionMode ?? "AUTO";
  const discoverer =
    selectionMode === "AUTO" && input.warcraftlogs
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
        blizzardSeasonId,
        selectionMode,
        discoverActiveMplusCatalog: discoverer,
        providerMode: input.providerMode,
        requestDistributionRefresh: async ({ seasonId, regionCode }) => {
          await session.refreshRegion({ seasonId, regionCode });
        },
      });
      return {
        blizzardSeasonId,
        skipped: false,
        reason: null,
        downloads: session.downloadCount(),
        regions: sync.regions,
      };
    },
  );
}
