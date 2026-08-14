/**
 * Canonical effective scoring season resolver.
 *
 * Detected Blizzard current (Season.isCurrent) is NOT the scoring season when
 * admins PIN a previous season. All refresh / WCL / scoring / publication paths
 * that mean "current platform season" must call this.
 */
import type { Logger } from "@mplus/observability";
import type { BlizzardProvider, ScoringSeasonSelection } from "@mplus/contracts";
import type { PrismaClient, Season } from "@mplus/database";
import {
  buildMplusCatalogEntryFromZone,
  parseWorldDataZonesPayload,
  selectActiveMythicPlusZone,
  type DiscoveredMplusCatalogEntry,
} from "@mplus/provider-warcraftlogs";
import {
  requireVerifiedSeasonAuthority,
  seasonAuthoritySlug,
  isNonProductSeasonSlug,
  type SeasonAuthorityDeps,
  type VerifiedSeasonAuthority,
} from "../season-authority.js";
import { evaluateSeasonCatalogReadiness } from "./catalog-readiness.js";
import { getScoringSeasonSelection } from "./selection-setting.js";
import { synchronizeActiveMplusSeasonCatalog } from "./synchronize.js";
import {
  ActiveMplusSeasonAmbiguousError,
  ActiveMplusSeasonCatalogIncompleteError,
  SeasonDungeonBindingsMissingError,
  type ActiveMythicPlusSeasonAuthority,
  type ActiveMplusDungeonIdentity,
} from "./types.js";
import { buildAuthorityFromSeason, loadSeasonDungeonIdentities } from "./resolve.js";
import { createFixtureRegistryCatalogDiscoverer } from "./zone-catalog-registry.js";

export interface EffectiveScoringSeason {
  selectionMode: ScoringSeasonSelection["mode"];
  selection: ScoringSeasonSelection;
  detected: VerifiedSeasonAuthority;
  /** Application Season row used for scoring. */
  season: Season;
  applicationSeasonId: string;
  seasonSlug: string;
  seasonDisplayName: string;
  blizzardSeasonId: number;
  wclZoneId: number;
  dungeons: ActiveMplusDungeonIdentity[];
  activeDungeonSlugs: string[];
  dungeonPoolHash: string;
  catalogVersion: string;
  catalogSource: "season_dungeon_bindings" | "synchronized_metadata" | "warcraftlogs_world_data";
  /** Refresh-contract activeSeasonId (slug). */
  activeSeasonId: string;
  bootstrapped: boolean;
  authority: ActiveMythicPlusSeasonAuthority;
}

export interface DiscoverActiveMplusCatalogFn {
  (input: { blizzardSeasonId: number }): Promise<DiscoveredMplusCatalogEntry>;
}

export interface ResolveEffectiveScoringSeasonInput {
  prisma: PrismaClient;
  blizzard: BlizzardProvider;
  logger: Logger;
  regionCode: string;
  regionId: string;
  /** When omitted, reads RuntimeSetting (missing => AUTO). */
  selection?: ScoringSeasonSelection;
  allowProviderSync?: boolean;
  forceRefreshAuthority?: boolean;
  correlationId?: string | null;
  now?: () => Date;
  /**
   * AUTO-only: discover + persist WCL catalog when effective season lacks a
   * validated catalog. PINNED never calls this.
   */
  discoverActiveMplusCatalog?: DiscoverActiveMplusCatalogFn;
}

function isPlaceholderSeason(season: Season): boolean {
  return isNonProductSeasonSlug(season.slug);
}

async function loadSeasonByBlizzardId(
  prisma: PrismaClient,
  regionId: string,
  blizzardSeasonId: number,
): Promise<Season | null> {
  const slug = seasonAuthoritySlug(blizzardSeasonId);
  const bySlug = await prisma.season.findFirst({
    where: { regionId, slug },
  });
  if (bySlug && !isPlaceholderSeason(bySlug)) return bySlug;
  return prisma.season.findFirst({
    where: { regionId, blizzardSeasonId },
    orderBy: { updatedAt: "desc" },
  });
}

/**
 * Build a discover function from a raw GraphQL WorldData zones fetcher.
 */
export function createWorldDataCatalogDiscoverer(fetchZonesPayload: () => Promise<unknown>): DiscoverActiveMplusCatalogFn {
  return async ({ blizzardSeasonId }) => {
    const raw = await fetchZonesPayload();
    const zones = parseWorldDataZonesPayload(raw);
    const selected = selectActiveMythicPlusZone(zones);
    if (selected.kind === "none") {
      throw new ActiveMplusSeasonCatalogIncompleteError(
        `ACTIVE_MPLUS_SEASON_CATALOG_INCOMPLETE: no active Mythic+ WCL zone for blizzard season ${blizzardSeasonId}`,
      );
    }
    if (selected.kind === "ambiguous") {
      throw new ActiveMplusSeasonAmbiguousError(
        `ACTIVE_MPLUS_SEASON_AMBIGUOUS: ${selected.candidates.length} active Mythic+ WCL zones ` +
          `(${selected.candidates.map((c) => c.id).join(",")})`,
      );
    }
    return buildMplusCatalogEntryFromZone(selected.zone, blizzardSeasonId);
  };
}

export function tryGetActiveMplusCatalogDiscoverer(
  wcl: unknown,
): DiscoverActiveMplusCatalogFn | undefined {
  if (
    wcl &&
    typeof wcl === "object" &&
    "discoverActiveMplusZoneCatalog" in wcl &&
    typeof (wcl as { discoverActiveMplusZoneCatalog?: unknown }).discoverActiveMplusZoneCatalog ===
      "function"
  ) {
    return (input) =>
      (
        wcl as {
          discoverActiveMplusZoneCatalog: DiscoverActiveMplusCatalogFn;
        }
      ).discoverActiveMplusZoneCatalog(input);
  }
  return undefined;
}

/**
 * Live WCL discoverer when present; fixture registry only when PROVIDER_MODE=fixture.
 * Live with WCL M+ unavailable still fails closed (no previous-season fallback).
 */
export function resolveScoringCatalogDiscoverer(input: {
  warcraftlogs?: unknown;
  providerMode?: string;
}): DiscoverActiveMplusCatalogFn | undefined {
  const fromWcl = tryGetActiveMplusCatalogDiscoverer(input.warcraftlogs);
  if (fromWcl) return fromWcl;
  if (input.providerMode === "fixture") {
    return createFixtureRegistryCatalogDiscoverer();
  }
  return undefined;
}

export async function resolveEffectiveScoringSeason(
  input: ResolveEffectiveScoringSeasonInput,
): Promise<EffectiveScoringSeason> {
  const nowFn = input.now ?? (() => new Date());
  const selectionRow = input.selection
    ? { selection: input.selection }
    : await getScoringSeasonSelection(input.prisma);
  const selection = selectionRow.selection;

  const authorityDeps: SeasonAuthorityDeps = {
    prisma: input.prisma,
    blizzard: input.blizzard,
    logger: input.logger,
    now: nowFn,
  };
  const detected = await requireVerifiedSeasonAuthority(
    authorityDeps,
    input.regionCode,
    input.regionId,
    {
      allowProviderSync: input.allowProviderSync ?? false,
      forceRefresh: input.forceRefreshAuthority ?? false,
      correlationId: input.correlationId ?? null,
    },
  );

  const effectiveBlizzardSeasonId =
    selection.mode === "PINNED" ? selection.blizzardSeasonId : detected.blizzardSeasonId;

  let season = await loadSeasonByBlizzardId(
    input.prisma,
    input.regionId,
    effectiveBlizzardSeasonId,
  );

  // AUTO: ensure we have the Blizzard current season row (may lack catalog).
  if (!season && selection.mode === "AUTO") {
    season = await input.prisma.season.findUnique({
      where: { id: detected.seasonRowId },
    });
  }

  if (!season) {
    throw new SeasonDungeonBindingsMissingError(
      selection.mode === "PINNED"
        ? `PINNED blizzard season ${effectiveBlizzardSeasonId}: no Season row for region ${input.regionCode}`
        : `AUTO: no Season row for blizzard season ${effectiveBlizzardSeasonId}`,
    );
  }

  let readiness = await evaluateSeasonCatalogReadiness(input.prisma, season);
  let bootstrapped = false;
  let catalogSource: EffectiveScoringSeason["catalogSource"] = "season_dungeon_bindings";

  if (!readiness.ready) {
    if (selection.mode === "PINNED") {
      throw new SeasonDungeonBindingsMissingError(
        `PINNED blizzard season ${effectiveBlizzardSeasonId} catalog not ready: ${readiness.reasons.join(",")}`,
      );
    }

    // AUTO bootstrap via WCL WorldData — never reuse previous season.
    if (!input.discoverActiveMplusCatalog) {
      throw new ActiveMplusSeasonCatalogIncompleteError(
        `ACTIVE_MPLUS_SEASON_CATALOG_INCOMPLETE: blizzard season ${effectiveBlizzardSeasonId} ` +
          `catalog incomplete (${readiness.reasons.join(",")}) and no WCL discoverer configured`,
      );
    }

    const discovered = await input.discoverActiveMplusCatalog({
      blizzardSeasonId: effectiveBlizzardSeasonId,
    });

    // Never activate (flip isCurrent) — Blizzard authority owns isCurrent.
    await synchronizeActiveMplusSeasonCatalog({
      prisma: input.prisma,
      regionId: input.regionId,
      regionCode: input.regionCode,
      blizzardSeasonId: effectiveBlizzardSeasonId,
      catalog: {
        wclZoneId: discovered.wclZoneId,
        blizzardSeasonId: discovered.blizzardSeasonId,
        expansionIdentity: discovered.expansionIdentity,
        displayName: discovered.displayName,
        dungeonSlugs: discovered.dungeonSlugs,
        encounterIds: discovered.encounterIds,
      },
      activate: false,
      now: nowFn(),
    });

    bootstrapped = true;
    catalogSource = "warcraftlogs_world_data";

    input.logger.info(
      {
        event: "active_mplus_catalog_bootstrapped",
        region: input.regionCode.toUpperCase(),
        blizzardSeasonId: effectiveBlizzardSeasonId,
        wclZoneId: discovered.wclZoneId,
        dungeonCount: discovered.dungeonSlugs.length,
        source: "warcraftlogs_world_data",
      },
      "active mplus catalog bootstrapped from WCL WorldData",
    );

    const reloaded = await loadSeasonByBlizzardId(
      input.prisma,
      input.regionId,
      effectiveBlizzardSeasonId,
    );
    if (!reloaded) {
      throw new ActiveMplusSeasonCatalogIncompleteError(
        `ACTIVE_MPLUS_SEASON_CATALOG_INCOMPLETE: bootstrap did not persist season ${effectiveBlizzardSeasonId}`,
      );
    }
    season = reloaded;
    readiness = await evaluateSeasonCatalogReadiness(input.prisma, season);
    if (!readiness.ready) {
      throw new ActiveMplusSeasonCatalogIncompleteError(
        `ACTIVE_MPLUS_SEASON_CATALOG_INCOMPLETE: after bootstrap still not ready: ${readiness.reasons.join(",")}`,
      );
    }
  }

  const dungeons = await loadSeasonDungeonIdentities(input.prisma, season.id);
  const authority = buildAuthorityFromSeason({
    season,
    dungeons,
    regionCode: input.regionCode,
    regionId: input.regionId,
    resolutionMode: selection.mode,
    diagnosticExpectedZoneId: null,
    autoDetectedZoneId:
      selection.mode === "PINNED" ? detected.blizzardSeasonId : null,
    now: nowFn(),
    metadataTtlSeconds: 86_400,
  });

  const wclZoneId = authority.wclZoneId;
  if (!Number.isInteger(wclZoneId) || wclZoneId <= 0) {
    throw new ActiveMplusSeasonCatalogIncompleteError(
      `ACTIVE_MPLUS_SEASON_CATALOG_INCOMPLETE: effective season ${season.slug} ` +
        `resolved without a positive persisted wclZoneId`,
    );
  }

  input.logger.info(
    {
      event: "scoring_season_resolved",
      mode: selection.mode,
      region: input.regionCode.toUpperCase(),
      detectedBlizzardSeasonId: detected.blizzardSeasonId,
      effectiveBlizzardSeasonId: authority.blizzardSeasonId,
      effectiveSeasonSlug: authority.seasonSlug,
      wclZoneId,
      catalogSource,
      bootstrapped,
    },
    "scoring season resolved",
  );

  return {
    selectionMode: selection.mode,
    selection,
    detected,
    season,
    applicationSeasonId: season.id,
    seasonSlug: season.slug,
    seasonDisplayName: season.name,
    blizzardSeasonId: authority.blizzardSeasonId ?? effectiveBlizzardSeasonId,
    wclZoneId,
    dungeons,
    activeDungeonSlugs: authority.activeDungeonSlugs,
    dungeonPoolHash: authority.dungeonPoolHash,
    catalogVersion: authority.catalogVersion,
    catalogSource,
    activeSeasonId: authority.seasonSlug,
    bootstrapped,
    authority,
  };
}
