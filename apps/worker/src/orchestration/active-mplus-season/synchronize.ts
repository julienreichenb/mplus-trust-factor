/**
 * Synchronize authoritative Mythic+ season dungeon bindings and activate.
 * Writes SeasonDungeon + validated metadata. Never uses max(zoneId) heuristics.
 */
import type { Prisma, PrismaClient } from "@mplus/database";
import { ensureDungeon, ensureRegionalBlizzardSeason } from "../../persistence/run-repository.js";
import { canonicalDungeonKey } from "../run-fusion.js";
import {
  mergeActiveMplusCatalogMetadata,
  type PersistedActiveMplusCatalogMetadata,
} from "./catalog-metadata.js";
import {
  ActiveMplusSeasonAmbiguousError,
  ActiveMplusSeasonCatalogIncompleteError,
  ACTIVE_MPLUS_SEASON_AUTHORITY_VERSION,
  computeDungeonPoolHash,
  computeSourceMetadataHash,
  type ActiveMplusOperationalState,
} from "./types.js";
import {
  lookupZoneCatalogByBlizzardSeasonId,
  lookupZoneCatalogByWclZoneId,
  type MplusZoneCatalogEntry,
  type MplusZoneCatalogRegistry,
  createDefaultMplusZoneCatalogRegistry,
} from "./zone-catalog-registry.js";

export interface SynchronizeActiveMplusSeasonInput {
  prisma: PrismaClient;
  regionId: string;
  regionCode: string;
  /** From Blizzard season_index.current_season — required for AUTO sync. */
  blizzardSeasonId: number;
  /**
   * WCL zone for this season. When omitted, resolved uniquely from the zone
   * catalog registry by blizzardSeasonId (fails if ambiguous/missing).
   */
  wclZoneId?: number | null;
  /**
   * Explicit catalog entry (dynamic WCL discovery). When provided, registry
   * lookup is skipped. Production AUTO bootstrap uses this path.
   */
  catalog?: MplusZoneCatalogEntry | null;
  registry?: MplusZoneCatalogRegistry;
  now?: Date;
  /**
 * When true (default), flip Season.isCurrent for Blizzard-authority sync.
 * Catalog hydration / historical repair MUST pass false.
   */
  activate?: boolean;
}

export interface SynchronizeActiveMplusSeasonResult {
  operationalState: ActiveMplusOperationalState;
  seasonId: string;
  seasonSlug: string;
  wclZoneId: number;
  blizzardSeasonId: number;
  dungeonPoolHash: string;
  dungeonSlugs: string[];
  createdBindings: number;
  alreadyPresent: number;
  activated: boolean;
  previousCurrentSeasonIds: string[];
}

/**
 * Normalize and validate the authoritative pool before any Season/SeasonDungeon
 * write. Provider aliases that canonicalize to the same slug are duplicates too.
 */
export function validateCatalogDungeonPool(
  catalog: MplusZoneCatalogEntry,
): MplusZoneCatalogEntry {
  const dungeonSlugs = catalog.dungeonSlugs.map((value) =>
    canonicalDungeonKey(typeof value === "string" ? value.trim() : String(value).trim()),
  );

  if (dungeonSlugs.length === 0 || dungeonSlugs.some((slug) => slug.length === 0)) {
    throw new ActiveMplusSeasonCatalogIncompleteError(
      "ACTIVE_MPLUS_SEASON_CATALOG_INCOMPLETE: empty dungeon pool",
    );
  }

  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const slug of dungeonSlugs) {
    if (seen.has(slug)) duplicates.add(slug);
    seen.add(slug);
  }
  if (duplicates.size > 0) {
    throw new ActiveMplusSeasonCatalogIncompleteError(
      `ACTIVE_MPLUS_SEASON_CATALOG_INCOMPLETE: duplicate dungeon slugs: ${[
        ...duplicates,
      ].join(",")}`,
    );
  }

  return {
    ...catalog,
    dungeonSlugs,
  };
}

function resolveCatalogEntry(
  registry: MplusZoneCatalogRegistry,
  blizzardSeasonId: number,
  wclZoneId: number | null | undefined,
  explicit: MplusZoneCatalogEntry | null | undefined,
): MplusZoneCatalogEntry {
  if (explicit) {
    if (explicit.dungeonSlugs.length === 0) {
      throw new ActiveMplusSeasonCatalogIncompleteError(
        "ACTIVE_MPLUS_SEASON_CATALOG_INCOMPLETE: empty dungeon pool",
      );
    }
    if (
      explicit.blizzardSeasonId != null &&
      explicit.blizzardSeasonId !== blizzardSeasonId
    ) {
      throw new ActiveMplusSeasonCatalogIncompleteError(
        `ACTIVE_MPLUS_SEASON_CATALOG_INCOMPLETE: catalog blizzard ${explicit.blizzardSeasonId} != expected ${blizzardSeasonId}`,
      );
    }
    return {
      ...explicit,
      blizzardSeasonId,
      dungeonSlugs: explicit.dungeonSlugs.map((s) =>
        typeof s === "string" ? s : String(s),
      ),
    };
  }

  if (wclZoneId != null) {
    const byZone = lookupZoneCatalogByWclZoneId(registry, wclZoneId);
    if (!byZone) {
      throw new ActiveMplusSeasonCatalogIncompleteError(
        `ACTIVE_MPLUS_SEASON_CATALOG_INCOMPLETE: no registry catalog for WCL zone ${wclZoneId}`,
      );
    }
    if (
      byZone.blizzardSeasonId != null &&
      byZone.blizzardSeasonId !== blizzardSeasonId
    ) {
      throw new ActiveMplusSeasonCatalogIncompleteError(
        `ACTIVE_MPLUS_SEASON_CATALOG_INCOMPLETE: zone ${wclZoneId} maps to blizzard ${byZone.blizzardSeasonId}, expected ${blizzardSeasonId}`,
      );
    }
    return byZone;
  }

  const matches = lookupZoneCatalogByBlizzardSeasonId(registry, blizzardSeasonId);
  if (matches.length === 0) {
    throw new ActiveMplusSeasonCatalogIncompleteError(
      `ACTIVE_MPLUS_SEASON_CATALOG_INCOMPLETE: no WCL zone catalog for blizzard season ${blizzardSeasonId}`,
    );
  }
  if (matches.length > 1) {
    throw new ActiveMplusSeasonAmbiguousError(
      `ACTIVE_MPLUS_SEASON_AMBIGUOUS: blizzard season ${blizzardSeasonId} maps to zones ${matches.map((m) => m.wclZoneId).join(",")}`,
    );
  }
  return matches[0]!;
}

export async function synchronizeActiveMplusSeasonCatalog(
  input: SynchronizeActiveMplusSeasonInput,
): Promise<SynchronizeActiveMplusSeasonResult> {
  const now = input.now ?? new Date();
  const registry = input.registry ?? createDefaultMplusZoneCatalogRegistry();
  const activate = input.activate !== false;
  const catalog = validateCatalogDungeonPool(
    resolveCatalogEntry(
      registry,
      input.blizzardSeasonId,
      input.wclZoneId,
      input.catalog,
    ),
  );

  const season = await ensureRegionalBlizzardSeason(
    input.prisma,
    input.regionId,
    input.blizzardSeasonId,
    { name: catalog.displayName },
  );

  let createdBindings = 0;
  let alreadyPresent = 0;
  const boundSlugs: string[] = [];
  const boundDungeonIds: string[] = [];

  for (let i = 0; i < catalog.dungeonSlugs.length; i++) {
    const dungeonSlug = catalog.dungeonSlugs[i]!;
    const encounterId = catalog.encounterIds[i] ?? null;
    const dungeon = await ensureDungeon(input.prisma, dungeonSlug);
    if (encounterId != null) {
      await input.prisma.dungeon.update({
        where: { id: dungeon.id },
        data: { wclZoneOrEncounterId: BigInt(encounterId) },
      });
    }
    const existing = await input.prisma.seasonDungeon.findUnique({
      where: {
        seasonId_dungeonId: { seasonId: season.id, dungeonId: dungeon.id },
      },
    });
    if (existing) {
      alreadyPresent += 1;
      if (existing.sortOrder !== i) {
        await input.prisma.seasonDungeon.update({
          where: {
            seasonId_dungeonId: { seasonId: season.id, dungeonId: dungeon.id },
          },
          data: { sortOrder: i },
        });
      }
    } else {
      await input.prisma.seasonDungeon.create({
        data: {
          seasonId: season.id,
          dungeonId: dungeon.id,
          sortOrder: i,
        },
      });
      createdBindings += 1;
    }
    boundSlugs.push(dungeonSlug);
    boundDungeonIds.push(dungeon.id);
  }

  if (boundDungeonIds.length > 0) {
    await input.prisma.seasonDungeon.deleteMany({
      where: {
        seasonId: season.id,
        dungeonId: { notIn: boundDungeonIds },
      },
    });
  }

  const dungeonPoolHash = computeDungeonPoolHash(boundSlugs);
  const catalogVersion = `${ACTIVE_MPLUS_SEASON_AUTHORITY_VERSION}:zone-${catalog.wclZoneId}:pool-${dungeonPoolHash.slice(0, 12)}`;
  const sourceMetadataHash = computeSourceMetadataHash({
    blizzardSeasonId: input.blizzardSeasonId,
    wclZoneId: catalog.wclZoneId,
    dungeonPoolHash,
    catalogVersion,
  });

  const catalogMeta: PersistedActiveMplusCatalogMetadata = {
    schemaVersion: "active-mplus-catalog-v1",
    wclZoneId: catalog.wclZoneId,
    blizzardSeasonId: input.blizzardSeasonId,
    expansionIdentity: catalog.expansionIdentity,
    dungeonPoolHash,
    sourceMetadataHash,
    catalogVersion,
    dungeonSlugs: boundSlugs,
    synchronizedAt: now.toISOString(),
    validatedAt: now.toISOString(),
    lastKnownGood: true,
    authorityVersion: ACTIVE_MPLUS_SEASON_AUTHORITY_VERSION,
  };

  const previousCurrent = await input.prisma.season.findMany({
    where: {
      regionId: input.regionId,
      isCurrent: true,
      NOT: { id: season.id },
    },
    select: { id: true, slug: true },
  });

  if (activate) {
    await input.prisma.$transaction(async (tx) => {
      await tx.season.updateMany({
        where: {
          regionId: input.regionId,
          isCurrent: true,
          NOT: { id: season!.id },
        },
        data: { isCurrent: false },
      });
      await tx.season.update({
        where: { id: season!.id },
        data: {
          isCurrent: true,
          blizzardSeasonId: input.blizzardSeasonId,
          dungeonCount: boundSlugs.length,
          name: catalog.displayName,
          metadata: mergeActiveMplusCatalogMetadata(season!.metadata, catalogMeta) as Prisma.InputJsonValue,
        },
      });
    });
  } else {
    await input.prisma.season.update({
      where: { id: season.id },
      data: {
        blizzardSeasonId: input.blizzardSeasonId,
        dungeonCount: boundSlugs.length,
        metadata: mergeActiveMplusCatalogMetadata(season.metadata, {
          ...catalogMeta,
          lastKnownGood: true,
        }) as Prisma.InputJsonValue,
      },
    });
  }

  return {
    operationalState: activate ? "NEW_SEASON_ACTIVATED" : "NEW_SEASON_VALIDATING",
    seasonId: season.id,
    seasonSlug: season.slug,
    wclZoneId: catalog.wclZoneId,
    blizzardSeasonId: input.blizzardSeasonId,
    dungeonPoolHash,
    dungeonSlugs: boundSlugs,
    createdBindings,
    alreadyPresent,
    activated: activate,
    previousCurrentSeasonIds: previousCurrent.map((s) => s.id),
  };
}

/**
 * When SeasonDungeon bindings are empty, attempt one bounded registry sync WRITE
 * without activating the season as Blizzard current.
 */
export async function ensurePersistedSeasonDungeonBindings(input: {
  prisma: PrismaClient;
  regionId: string;
  regionCode: string;
  seasonId: string;
  blizzardSeasonId: number | null;
  registry?: MplusZoneCatalogRegistry;
  wclZoneId?: number | null;
}): Promise<{ dungeonSlugs: string[]; synchronized: boolean }> {
  const existing = await input.prisma.seasonDungeon.findMany({
    where: { seasonId: input.seasonId },
    include: { dungeon: true },
    orderBy: { sortOrder: "asc" },
  });
  if (existing.length > 0) {
    return {
      dungeonSlugs: existing.map((row) => row.dungeon.slug),
      synchronized: false,
    };
  }
  if (input.blizzardSeasonId == null) {
    throw new ActiveMplusSeasonCatalogIncompleteError(
      `ACTIVE_MPLUS_SEASON_CATALOG_INCOMPLETE: season ${input.seasonId} has empty bindings and no blizzardSeasonId`,
    );
  }
  const sync = await synchronizeActiveMplusSeasonCatalog({
    prisma: input.prisma,
    regionId: input.regionId,
    regionCode: input.regionCode,
    blizzardSeasonId: input.blizzardSeasonId,
    wclZoneId: input.wclZoneId,
    registry: input.registry ?? createDefaultMplusZoneCatalogRegistry(),
    activate: false,
  });
  return { dungeonSlugs: sync.dungeonSlugs, synchronized: true };
}
