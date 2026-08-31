/**
 * Product-level fan-out: one Blizzard season → four regional Season identities
 * via ensureRegionalBlizzardSeason + ensureSeasonDataReady.
 * Does not duplicate catalog, ingest, or authority logic.
 */
import type { Logger } from "@mplus/observability";
import type { PrismaClient } from "@mplus/database";
import { KEY_CONTEXT_REGION_CODES, type BlizzardProvider } from "@mplus/contracts";
import { ensureRegionalBlizzardSeason } from "../../persistence/run-repository.js";
import {
  ensureSeasonDataReady,
  type EnsureSeasonDataReadyInput,
  type SeasonDataReadyResult,
} from "./ensure-season-data-ready.js";

export interface ScoringSeasonRegionSyncResult {
  regionCode: string;
  ok: boolean;
  error: string | null;
  seasonId: string | null;
  result: SeasonDataReadyResult | null;
}

export async function synchronizeScoringSeasonData(input: {
  prisma: PrismaClient;
  logger: Logger;
  blizzardSeasonId: number;
  selectionMode?: EnsureSeasonDataReadyInput["selectionMode"];
  discoverActiveMplusCatalog?: EnsureSeasonDataReadyInput["discoverActiveMplusCatalog"];
  providerMode?: EnsureSeasonDataReadyInput["providerMode"];
  registry?: EnsureSeasonDataReadyInput["registry"];
  requestDistributionRefresh?: EnsureSeasonDataReadyInput["requestDistributionRefresh"];
  blizzard?: BlizzardProvider;
  now?: Date;
}): Promise<{
  blizzardSeasonId: number;
  regions: ScoringSeasonRegionSyncResult[];
}> {
  const regions: ScoringSeasonRegionSyncResult[] = [];
  for (const regionCode of KEY_CONTEXT_REGION_CODES) {
    try {
      const region = await input.prisma.region.findFirst({
        where: { code: { equals: regionCode, mode: "insensitive" } },
      });
      if (!region) {
        regions.push({
          regionCode,
          ok: false,
          error: `REGION_NOT_FOUND:${regionCode}`,
          seasonId: null,
          result: null,
        });
        continue;
      }
      const season = await ensureRegionalBlizzardSeason(
        input.prisma,
        region.id,
        input.blizzardSeasonId,
      );
      const result = await ensureSeasonDataReady({
        prisma: input.prisma,
        logger: input.logger,
        regionId: region.id,
        regionCode,
        blizzardSeasonId: input.blizzardSeasonId,
        selectionMode: input.selectionMode,
        discoverActiveMplusCatalog: input.discoverActiveMplusCatalog,
        providerMode: input.providerMode,
        registry: input.registry,
        requestDistributionRefresh: input.requestDistributionRefresh,
        blizzard: input.blizzard,
        now: input.now,
      });
      regions.push({
        regionCode,
        ok: result.status !== "failed",
        error: result.distributionError,
        seasonId: season.id,
        result,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      input.logger.warn(
        { err: error, regionCode, blizzardSeasonId: input.blizzardSeasonId },
        "scoring season region sync failed — continuing other regions",
      );
      regions.push({
        regionCode,
        ok: false,
        error: message,
        seasonId: null,
        result: null,
      });
    }
  }
  return { blizzardSeasonId: input.blizzardSeasonId, regions };
}
