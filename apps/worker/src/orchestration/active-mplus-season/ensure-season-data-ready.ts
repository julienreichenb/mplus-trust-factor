/**
 * Shared season base-data orchestration: catalog readiness + optional
 * downstream median-key refresh. Never flips Blizzard Season.isCurrent.
 */
import { randomUUID } from "node:crypto";
import type { Logger } from "@mplus/observability";
import type { PrismaClient, Season } from "@mplus/database";
import { evaluateSeasonCatalogReadiness, type CatalogReadinessResult } from "./catalog-readiness.js";
import { readActiveMplusCatalogMetadata } from "./catalog-metadata.js";
import { synchronizeActiveMplusSeasonCatalog } from "./synchronize.js";
import { enrichSeasonDungeonArtwork } from "./enrich-dungeon-artwork.js";
import {
  createDefaultMplusZoneCatalogRegistry,
  lookupZoneCatalogByBlizzardSeasonId,
  lookupZoneCatalogByWclZoneId,
  type MplusZoneCatalogEntry,
  type MplusZoneCatalogRegistry,
} from "./zone-catalog-registry.js";
import { ActiveMplusSeasonAmbiguousError, ActiveMplusSeasonCatalogIncompleteError } from "./types.js";
import { isNonProductSeasonSlug, seasonAuthoritySlug } from "../season-authority.js";
import type { BlizzardProvider } from "@mplus/contracts";

export type SeasonCatalogDiscoverFn = (input: {
  blizzardSeasonId: number;
}) => Promise<{
  wclZoneId: number;
  blizzardSeasonId: number;
  expansionIdentity: string | null;
  displayName: string;
  dungeonSlugs: string[];
  encounterIds: number[];
}>;

export type SeasonCatalogSyncSource =
  | "already_ready"
  | "zone_catalog_registry"
  | "warcraftlogs_world_data"
  | "persisted_wcl_zone"
  | "none";

export interface SeasonDataReadyResult {
  seasonId: string | null;
  blizzardSeasonId: number;
  regionCode: string;
  selectionMode: "AUTO" | "PINNED" | null;
  catalogReadyBefore: boolean;
  catalogReadyAfter: boolean;
  dungeonCount: number;
  expectedDungeonCount: number | null;
  wclZoneId: number | null;
  reasons: string[];
  catalogSource: SeasonCatalogSyncSource;
  skippedReady: boolean;
  catalogSynced: boolean;
  activated: false;
  distributionRequested: boolean;
  distributionError: string | null;
  status: "ready" | "partial" | "failed";
}

export interface EnsureSeasonDataReadyInput {
  prisma: PrismaClient;
  logger: Logger;
  regionId: string;
  regionCode: string;
  blizzardSeasonId: number;
  selectionMode?: "AUTO" | "PINNED" | null;
  discoverActiveMplusCatalog?: SeasonCatalogDiscoverFn;
  registry?: MplusZoneCatalogRegistry;
  now?: Date;
  /**
   * After catalog is ready, invoke this to enqueue median-key refresh.
   * Must not throw into catalog success — callers should catch inside.
   */
  requestDistributionRefresh?: (input: {
    seasonId: string;
    blizzardSeasonId: number;
    regionCode: string;
  }) => Promise<void>;
  /** Optional Blizzard provider for non-critical dungeon artwork enrichment. */
  blizzard?: BlizzardProvider;
  /** When fixture, skip live WCL authority comparison during readiness. */
  providerMode?: string;
}

function catalogFromDiscovered(
  discovered: Awaited<ReturnType<SeasonCatalogDiscoverFn>>,
  blizzardSeasonId: number,
): MplusZoneCatalogEntry {
  return {
    wclZoneId: discovered.wclZoneId,
    blizzardSeasonId,
    expansionIdentity: discovered.expansionIdentity,
    displayName: discovered.displayName,
    dungeonSlugs: discovered.dungeonSlugs,
    encounterIds: discovered.encounterIds,
  };
}

async function loadTargetSeason(
  prisma: PrismaClient,
  regionId: string,
  blizzardSeasonId: number,
): Promise<Season | null> {
  const slug = seasonAuthoritySlug(blizzardSeasonId);
  const bySlug = await prisma.season.findFirst({ where: { regionId, slug } });
  if (bySlug && !isNonProductSeasonSlug(bySlug.slug)) return bySlug;
  return prisma.season.findFirst({
    where: { regionId, blizzardSeasonId },
    orderBy: { updatedAt: "desc" },
  });
}

async function resolveCatalogForSeason(input: {
  blizzardSeasonId: number;
  selectionMode: "AUTO" | "PINNED" | null;
  season: Season | null;
  discoverActiveMplusCatalog?: SeasonCatalogDiscoverFn;
  registry: MplusZoneCatalogRegistry;
  preDiscoveredCatalog?: MplusZoneCatalogEntry | null;
}): Promise<{ catalog: MplusZoneCatalogEntry; source: SeasonCatalogSyncSource } | { error: string }> {
  const {
    blizzardSeasonId,
    selectionMode,
    season,
    discoverActiveMplusCatalog,
    registry,
    preDiscoveredCatalog,
  } = input;
  let discoveryError: string | null = null;

  if (preDiscoveredCatalog) {
    return { catalog: preDiscoveredCatalog, source: "warcraftlogs_world_data" };
  }

  // Live WCL "active zone" discovery is AUTO-only. PINNED historical seasons
  // must not bind whatever zone is currently active worldwide.
  if (selectionMode !== "PINNED" && discoverActiveMplusCatalog) {
    try {
      const discovered = await discoverActiveMplusCatalog({ blizzardSeasonId });
      return {
        catalog: catalogFromDiscovered(discovered, blizzardSeasonId),
        source: "warcraftlogs_world_data",
      };
    } catch (error) {
      if (
        error instanceof ActiveMplusSeasonAmbiguousError ||
        (error instanceof Error &&
          "code" in error &&
          (error as { code?: string }).code === "ACTIVE_MPLUS_SEASON_AMBIGUOUS")
      ) {
        throw error;
      }
      discoveryError = error instanceof Error ? error.message : String(error);
    }
  }

  const byBlizzard = lookupZoneCatalogByBlizzardSeasonId(registry, blizzardSeasonId);
  if (byBlizzard.length > 1) {
    throw new ActiveMplusSeasonAmbiguousError(
      `ACTIVE_MPLUS_SEASON_AMBIGUOUS: blizzard season ${blizzardSeasonId} maps to zones ${byBlizzard.map((m) => m.wclZoneId).join(",")}`,
    );
  }
  if (byBlizzard.length === 1) {
    return { catalog: byBlizzard[0]!, source: "zone_catalog_registry" };
  }

  const persistedZone = season ? readActiveMplusCatalogMetadata(season.metadata)?.wclZoneId : null;
  if (persistedZone != null) {
    const byZone = lookupZoneCatalogByWclZoneId(registry, persistedZone);
    if (
      byZone &&
      (byZone.blizzardSeasonId == null || byZone.blizzardSeasonId === blizzardSeasonId)
    ) {
      return { catalog: { ...byZone, blizzardSeasonId }, source: "persisted_wcl_zone" };
    }
  }

  return {
    error:
      discoveryError ??
      `ACTIVE_MPLUS_SEASON_CATALOG_INCOMPLETE: no authoritative M+ catalog for blizzard season ${blizzardSeasonId}`,
  };
}

export async function ensureSeasonDataReady(
  input: EnsureSeasonDataReadyInput,
): Promise<SeasonDataReadyResult> {
  const regionCode = input.regionCode.toUpperCase();
  const selectionMode = input.selectionMode ?? null;
  const registry = input.registry ?? createDefaultMplusZoneCatalogRegistry();
  let season = await loadTargetSeason(input.prisma, input.regionId, input.blizzardSeasonId);

  input.logger.info(
    {
      event: "season_data_sync_started",
      region: regionCode,
      seasonId: season?.id ?? null,
      blizzardSeasonId: input.blizzardSeasonId,
      selectionMode,
    },
    "season data sync started",
  );

  const emptyReadiness = (reasons: string[]): CatalogReadinessResult => ({
    ready: false,
    reasons,
    wclZoneId: null,
    blizzardSeasonId: input.blizzardSeasonId,
    dungeonPoolHash: null,
    dungeonCount: 0,
    expectedDungeonCount: null,
  });

  let authoritativeCatalog: MplusZoneCatalogEntry | null = null;
  if (
    selectionMode !== "PINNED" &&
    input.discoverActiveMplusCatalog &&
    input.providerMode !== "fixture"
  ) {
    try {
      const discovered = await input.discoverActiveMplusCatalog({
        blizzardSeasonId: input.blizzardSeasonId,
      });
      authoritativeCatalog = catalogFromDiscovered(discovered, input.blizzardSeasonId);
    } catch (error) {
      input.logger.warn(
        {
          event: "season_catalog_authority_discovery_failed",
          region: regionCode,
          seasonId: season?.id ?? null,
          blizzardSeasonId: input.blizzardSeasonId,
          error: error instanceof Error ? error.message.slice(0, 300) : String(error),
        },
        "authoritative catalog discovery failed during readiness check",
      );
    }
  }

  let before = season
    ? await evaluateSeasonCatalogReadiness(input.prisma, season, {
        registry,
        authoritativeCatalog,
      })
    : emptyReadiness(["season_row_missing", "season_dungeon_bindings_empty"]);

  const base = (): Omit<
    SeasonDataReadyResult,
    "status" | "catalogSynced" | "skippedReady" | "catalogSource" | "distributionRequested" | "distributionError"
  > => ({
    seasonId: season?.id ?? null,
    blizzardSeasonId: input.blizzardSeasonId,
    regionCode,
    selectionMode,
    catalogReadyBefore: before.ready,
    catalogReadyAfter: before.ready,
    dungeonCount: before.dungeonCount,
    expectedDungeonCount: before.expectedDungeonCount,
    wclZoneId: before.wclZoneId,
    reasons: before.reasons,
    activated: false,
  });

    const finish = async (
    partial: Pick<
      SeasonDataReadyResult,
      "catalogSource" | "skippedReady" | "catalogSynced"
    > & { after?: CatalogReadinessResult },
  ): Promise<SeasonDataReadyResult> => {
    const after = partial.after ?? before;
    let distributionRequested = false;
    let distributionError: string | null = null;
    if (after.ready && season && input.requestDistributionRefresh) {
      try {
        await input.requestDistributionRefresh({
          seasonId: season.id,
          blizzardSeasonId: input.blizzardSeasonId,
          regionCode,
        });
        distributionRequested = true;
        input.logger.info(
          {
            event: "season_distribution_sync_requested",
            region: regionCode,
            seasonId: season.id,
            blizzardSeasonId: input.blizzardSeasonId,
          },
          "season median-key distribution refresh requested",
        );
      } catch (error) {
        distributionError = error instanceof Error ? error.message : String(error);
        input.logger.warn(
          {
            event: "season_data_sync_partial",
            region: regionCode,
            seasonId: season.id,
            blizzardSeasonId: input.blizzardSeasonId,
            reason: "distribution_refresh_failed",
            error: distributionError.slice(0, 300),
          },
          "catalog ready; median-key distribution request failed",
        );
      }
    }

    // Artwork is display metadata: enrich even when catalog was already ready.
    if (after.ready && season && input.blizzard) {
      try {
        await enrichSeasonDungeonArtwork({
          prisma: input.prisma,
          blizzard: input.blizzard,
          logger: input.logger,
          seasonId: season.id,
          regionCode,
          now: input.now,
        });
      } catch (error) {
        input.logger.warn(
          {
            event: "dungeon_artwork_enrichment_failed",
            region: regionCode,
            seasonId: season.id,
            error: error instanceof Error ? error.message.slice(0, 300) : String(error),
          },
          "catalog ready; dungeon artwork enrichment failed",
        );
      }
    }

    const result: SeasonDataReadyResult = {
      ...base(),
      catalogReadyAfter: after.ready,
      dungeonCount: after.dungeonCount,
      expectedDungeonCount: after.expectedDungeonCount,
      wclZoneId: after.wclZoneId,
      reasons: after.reasons,
      catalogSource: partial.catalogSource,
      skippedReady: partial.skippedReady,
      catalogSynced: partial.catalogSynced,
      distributionRequested,
      distributionError,
      status: !after.ready ? "failed" : distributionError ? "partial" : "ready",
    };

    if (result.status === "failed") {
      input.logger.warn(
        {
          event: "season_data_sync_failed",
          region: regionCode,
          seasonId: season?.id ?? null,
          blizzardSeasonId: input.blizzardSeasonId,
          selectionMode,
          catalogReadyBefore: before.ready,
          catalogReadyAfter: after.ready,
          dungeonCount: after.dungeonCount,
          wclZoneId: after.wclZoneId,
          source: partial.catalogSource,
          reasons: after.reasons,
        },
        "season data sync failed",
      );
    } else if (partial.skippedReady) {
      input.logger.info(
        {
          event: "season_catalog_sync_skipped_ready",
          region: regionCode,
          seasonId: season?.id ?? null,
          blizzardSeasonId: input.blizzardSeasonId,
          dungeonCount: after.dungeonCount,
          wclZoneId: after.wclZoneId,
        },
        "season catalog already ready",
      );
    } else {
      input.logger.info(
        {
          event: "season_catalog_sync_completed",
          region: regionCode,
          seasonId: season?.id ?? null,
          blizzardSeasonId: input.blizzardSeasonId,
          selectionMode,
          catalogReadyBefore: before.ready,
          catalogReadyAfter: after.ready,
          dungeonCount: after.dungeonCount,
          wclZoneId: after.wclZoneId,
          source: partial.catalogSource,
        },
        "season catalog sync completed",
      );
    }
    return result;
  };

  if (before.ready && season) {
    return finish({ catalogSource: "already_ready", skippedReady: true, catalogSynced: false });
  }

  const resolved = await resolveCatalogForSeason({
    blizzardSeasonId: input.blizzardSeasonId,
    selectionMode,
    season,
    discoverActiveMplusCatalog: input.discoverActiveMplusCatalog,
    registry,
    preDiscoveredCatalog: authoritativeCatalog,
  });

  if ("error" in resolved) {
    if (!before.ready) {
      before = {
        ...before,
        reasons: [...before.reasons, "authoritative_catalog_unavailable"],
      };
    }
    return finish({
      catalogSource: "none",
      skippedReady: false,
      catalogSynced: false,
      after: {
        ...before,
        reasons: [...new Set([...before.reasons, resolved.error])],
      },
    });
  }

  const sync = await synchronizeActiveMplusSeasonCatalog({
    prisma: input.prisma,
    regionId: input.regionId,
    regionCode,
    blizzardSeasonId: input.blizzardSeasonId,
    catalog: resolved.catalog,
    activate: false,
    now: input.now,
    registry,
  });

  season = await loadTargetSeason(input.prisma, input.regionId, input.blizzardSeasonId);
  if (!season) {
    throw new ActiveMplusSeasonCatalogIncompleteError(
      `ACTIVE_MPLUS_SEASON_CATALOG_INCOMPLETE: catalog write did not persist blizzard season ${input.blizzardSeasonId}`,
    );
  }
  const after = await evaluateSeasonCatalogReadiness(input.prisma, season, {
    registry,
    authoritativeCatalog,
  });
  return finish({
    catalogSource: resolved.source,
    skippedReady: false,
    catalogSynced: sync.createdBindings > 0 || sync.alreadyPresent > 0,
    after,
  });
}

export async function requestKeyDistributionRefreshJob(input: {
  prisma: PrismaClient;
  enqueue: (job: {
    refreshId: string;
    seasonId: string;
    region: "EU" | "US" | "KR" | "TW";
  }) => Promise<unknown>;
  seasonId: string;
  regionCode: string;
  requestedByUserId?: string | null;
}): Promise<{ refreshId: string; skipped: boolean }> {
  const region = input.regionCode.trim().toUpperCase();
  if (region !== "EU" && region !== "US" && region !== "KR" && region !== "TW") {
    return { refreshId: "", skipped: true };
  }
  const season = await input.prisma.season.findUnique({
    where: { id: input.seasonId },
    select: { region: { select: { code: true } } },
  });
  const seasonRegion = season?.region?.code?.toUpperCase();
  if (seasonRegion && seasonRegion !== region) {
    throw new Error(`KEY_DISTRIBUTION_REGION_MISMATCH: job ${region} vs season ${seasonRegion}`);
  }
  const inflight = await input.prisma.scoreContextKeyDistributionRefresh.findFirst({
    where: { seasonId: input.seasonId, status: { in: ["QUEUED", "RUNNING"] } },
    orderBy: { createdAt: "desc" },
  });
  if (inflight) {
    return { refreshId: inflight.id, skipped: true };
  }
  const refreshId = randomUUID();
  await input.prisma.scoreContextKeyDistributionRefresh.create({
    data: {
      id: refreshId,
      seasonId: input.seasonId,
      region,
      status: "QUEUED",
      requestedByUserId: input.requestedByUserId ?? null,
    },
  });
  await input.enqueue({ refreshId, seasonId: input.seasonId, region });
  return { refreshId, skipped: false };
}
