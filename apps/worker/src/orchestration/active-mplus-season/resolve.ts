/**
 * Resolve the active Mythic+ season authority for a region.
 * Production READ path — never falls back to static dungeon arrays.
 */
import type { PrismaClient, Season } from "@mplus/database";
import { EVIDENCE_SLOTS_PER_DUNGEON } from "@mplus/contracts";
import { canonicalDungeonKey } from "../run-fusion.js";
import { isNonProductSeasonSlug } from "../season-authority.js";
import { readActiveMplusCatalogMetadata } from "./catalog-metadata.js";
import {
  ACTIVE_MPLUS_SEASON_AUTHORITY_VERSION,
  SeasonDungeonBindingsMissingError,
  ActiveMplusSeasonAmbiguousError,
  computeDungeonPoolHash,
  computeSourceMetadataHash,
  expectedSlotsForDungeonCount,
  type ActiveMythicPlusSeasonAuthority,
  type ActiveMplusDungeonIdentity,
  type ActiveMplusResolutionMode,
} from "./types.js";

export interface ResolveActiveMplusSeasonInput {
  prisma: PrismaClient;
  regionCode: string;
  regionId: string;
  resolutionMode: ActiveMplusResolutionMode;
  /** Required when resolutionMode=PINNED. */
  pinnedWclZoneId?: number | null;
  /** AUTO diagnostic expected zone from env (does not force selection). */
  diagnosticExpectedZoneId?: number | null;
  now?: Date;
  /** Metadata TTL for staleness (seconds). */
  metadataTtlSeconds?: number;
}

function isPlaceholderSeason(season: Season): boolean {
  return isNonProductSeasonSlug(season.slug);
}

function hasValidatedCatalog(season: Season): boolean {
  const meta = readActiveMplusCatalogMetadata(season.metadata);
  return meta != null && meta.lastKnownGood === true && meta.dungeonSlugs.length > 0;
}

export async function loadSeasonDungeonIdentities(
  prisma: PrismaClient,
  seasonId: string,
): Promise<ActiveMplusDungeonIdentity[]> {
  const rows = await prisma.seasonDungeon.findMany({
    where: { seasonId },
    include: { dungeon: true },
    orderBy: { sortOrder: "asc" },
  });
  return rows.map((row) => ({
    slug: canonicalDungeonKey(row.dungeon.slug),
    dungeonId: row.dungeon.id,
    sortOrder: row.sortOrder,
    wclEncounterId:
      row.dungeon.wclZoneOrEncounterId != null
        ? Number(row.dungeon.wclZoneOrEncounterId)
        : null,
  }));
}

async function findCurrentValidatedSeasons(
  prisma: PrismaClient,
  regionId: string,
): Promise<Season[]> {
  const currents = await prisma.season.findMany({
    where: { regionId, isCurrent: true },
    orderBy: { updatedAt: "desc" },
  });
  return currents.filter((s) => !isPlaceholderSeason(s) && hasValidatedCatalog(s));
}

async function findPinnedSeason(
  prisma: PrismaClient,
  regionId: string,
  wclZoneId: number,
): Promise<Season | null> {
  const seasons = await prisma.season.findMany({
    where: { regionId },
    orderBy: [{ isCurrent: "desc" }, { updatedAt: "desc" }],
  });
  for (const season of seasons) {
    if (isPlaceholderSeason(season)) continue;
    const meta = readActiveMplusCatalogMetadata(season.metadata);
    if (meta?.wclZoneId === wclZoneId && meta.lastKnownGood) return season;
  }
  return null;
}

export function buildAuthorityFromSeason(input: {
  season: Season;
  dungeons: ActiveMplusDungeonIdentity[];
  regionCode: string;
  regionId: string;
  resolutionMode: ActiveMplusResolutionMode;
  diagnosticExpectedZoneId: number | null;
  autoDetectedZoneId: number | null;
  now: Date;
  metadataTtlSeconds: number;
}): ActiveMythicPlusSeasonAuthority {
  const meta = readActiveMplusCatalogMetadata(input.season.metadata);
  if (!meta || input.dungeons.length === 0) {
    throw new SeasonDungeonBindingsMissingError(
      `Season ${input.season.slug} (${input.season.id}) has no validated SeasonDungeon bindings`,
    );
  }

  const slugs = input.dungeons.map((d) => d.slug);
  const poolHash = computeDungeonPoolHash(slugs);
  if (poolHash !== meta.dungeonPoolHash) {
    throw new SeasonDungeonBindingsMissingError(
      `Season ${input.season.slug} dungeon-pool hash mismatch: bindings=${poolHash} metadata=${meta.dungeonPoolHash}`,
    );
  }

  const synchronizedAt = meta.synchronizedAt || null;
  const syncAgeMs = synchronizedAt
    ? input.now.getTime() - Date.parse(synchronizedAt)
    : Number.POSITIVE_INFINITY;
  const stale =
    !Number.isFinite(syncAgeMs) ||
    syncAgeMs > input.metadataTtlSeconds * 1000;

  const warnings: string[] = [];
  let diagnosticZoneMatch: boolean | null = null;
  if (
    input.resolutionMode === "AUTO" &&
    input.diagnosticExpectedZoneId != null
  ) {
    diagnosticZoneMatch = input.diagnosticExpectedZoneId === meta.wclZoneId;
    if (!diagnosticZoneMatch) {
      warnings.push(
        `DIAGNOSTIC_ZONE_MISMATCH: diagnosticExpectedZoneId=${input.diagnosticExpectedZoneId} active=${meta.wclZoneId}`,
      );
    }
  }
  if (input.resolutionMode === "PINNED" && input.autoDetectedZoneId != null) {
    if (input.autoDetectedZoneId !== meta.wclZoneId) {
      warnings.push(
        `PINNED_ZONE_DIFFERS_FROM_AUTO: pinned=${meta.wclZoneId} auto=${input.autoDetectedZoneId}`,
      );
    }
  }

  const catalogVersion =
    meta.catalogVersion ||
    `${ACTIVE_MPLUS_SEASON_AUTHORITY_VERSION}:zone-${meta.wclZoneId}:pool-${poolHash.slice(0, 12)}`;

  return {
    authorityVersion: ACTIVE_MPLUS_SEASON_AUTHORITY_VERSION,
    resolutionMode: input.resolutionMode,
    operationalState: stale ? "ACTIVE_SEASON_METADATA_STALE" : "ACTIVE_SEASON_CURRENT",
    applicationSeasonId: input.season.id,
    seasonSlug: input.season.slug,
    seasonDisplayName: input.season.name,
    expansionIdentity: meta.expansionIdentity,
    blizzardSeasonId: meta.blizzardSeasonId ?? input.season.blizzardSeasonId,
    raiderIoSeasonSlug: null,
    wclZoneId: meta.wclZoneId,
    active: input.season.isCurrent,
    frozen: false,
    validFrom: input.season.startsAt?.toISOString() ?? null,
    validUntil: input.season.endsAt?.toISOString() ?? null,
    catalogSource: "season_dungeon_bindings",
    catalogVersion,
    sourceMetadataHash:
      meta.sourceMetadataHash ||
      computeSourceMetadataHash({
        blizzardSeasonId: meta.blizzardSeasonId,
        wclZoneId: meta.wclZoneId,
        dungeonPoolHash: poolHash,
        catalogVersion,
      }),
    dungeonPoolHash: poolHash,
    dungeons: input.dungeons,
    activeDungeonSlugs: slugs,
    expectedDungeonCount: slugs.length,
    runsPerDungeon: EVIDENCE_SLOTS_PER_DUNGEON,
    expectedSlotCount: expectedSlotsForDungeonCount(slugs.length),
    synchronizedAt,
    validatedAt: meta.validatedAt || input.now.toISOString(),
    lastKnownGood: meta.lastKnownGood,
    diagnosticExpectedZoneId: input.diagnosticExpectedZoneId,
    diagnosticZoneMatch,
    autoDetectedZoneId: input.autoDetectedZoneId,
    lineage: {
      regionCode: input.regionCode.toUpperCase(),
      regionId: input.regionId,
      seasonRowId: input.season.id,
      dungeonPoolHash: poolHash,
      catalogVersion,
      wclZoneId: meta.wclZoneId,
    },
    warnings,
  };
}

/**
 * Resolve active M+ season. Fails closed when bindings are missing.
 * Never uses CURRENT_MPLUS_ZONE_DUNGEON_SLUGS / static arrays.
 */
export async function resolveActiveMythicPlusSeason(
  input: ResolveActiveMplusSeasonInput,
): Promise<ActiveMythicPlusSeasonAuthority> {
  const now = input.now ?? new Date();
  const metadataTtlSeconds = input.metadataTtlSeconds ?? 86_400;
  const diagnosticExpectedZoneId = input.diagnosticExpectedZoneId ?? null;

  if (input.resolutionMode === "PINNED") {
    const pinned = input.pinnedWclZoneId;
    if (pinned == null || !Number.isInteger(pinned) || pinned <= 0) {
      throw new SeasonDungeonBindingsMissingError(
        "PINNED mode requires a positive pinnedWclZoneId",
      );
    }
    const season = await findPinnedSeason(input.prisma, input.regionId, pinned);
    if (!season) {
      throw new SeasonDungeonBindingsMissingError(
        `PINNED zone ${pinned}: no validated season catalog for region ${input.regionCode}`,
      );
    }
    const dungeons = await loadSeasonDungeonIdentities(input.prisma, season.id);
    if (dungeons.length === 0) {
      throw new SeasonDungeonBindingsMissingError(
        `PINNED zone ${pinned}: SeasonDungeon bindings missing for ${season.slug}`,
      );
    }

    // Best-effort auto-detect for comparison (validated current, may differ).
    let autoDetectedZoneId: number | null = null;
    const validatedCurrents = await findCurrentValidatedSeasons(
      input.prisma,
      input.regionId,
    );
    if (validatedCurrents[0]) {
      const autoMeta = readActiveMplusCatalogMetadata(validatedCurrents[0].metadata);
      autoDetectedZoneId = autoMeta?.wclZoneId ?? null;
    }

    return buildAuthorityFromSeason({
      season,
      dungeons,
      regionCode: input.regionCode,
      regionId: input.regionId,
      resolutionMode: "PINNED",
      diagnosticExpectedZoneId: pinned,
      autoDetectedZoneId,
      now,
      metadataTtlSeconds,
    });
  }

  // AUTO
  const validatedCurrents = await findCurrentValidatedSeasons(
    input.prisma,
    input.regionId,
  );
  if (validatedCurrents.length > 1) {
    throw new ActiveMplusSeasonAmbiguousError(
      `ACTIVE_MPLUS_SEASON_AMBIGUOUS: ${validatedCurrents.length} validated isCurrent seasons for region ${input.regionCode}`,
    );
  }

  // Prefer validated current; never prefer placeholder over validated.
  const season = validatedCurrents[0] ?? null;
  if (!season) {
    // Any validated catalog season for region (even if isCurrent false) is not auto-selected —
    // missing current validated catalog fails closed.
    const allCurrent = await input.prisma.season.findMany({
      where: { regionId: input.regionId, isCurrent: true },
    });
    const placeholders = allCurrent.filter(isPlaceholderSeason);
    if (placeholders.length > 0 && allCurrent.every(isPlaceholderSeason)) {
      throw new SeasonDungeonBindingsMissingError(
        `SEASON_DUNGEON_BINDINGS_MISSING: only placeholder/auto-current rows are isCurrent for ${input.regionCode}`,
      );
    }
    throw new SeasonDungeonBindingsMissingError(
      `SEASON_DUNGEON_BINDINGS_MISSING: no validated active Mythic+ season for ${input.regionCode}`,
    );
  }

  const dungeons = await loadSeasonDungeonIdentities(input.prisma, season.id);
  if (dungeons.length === 0) {
    throw new SeasonDungeonBindingsMissingError(
      `SEASON_DUNGEON_BINDINGS_MISSING: ${season.slug} has empty SeasonDungeon bindings`,
    );
  }

  return buildAuthorityFromSeason({
    season,
    dungeons,
    regionCode: input.regionCode,
    regionId: input.regionId,
    resolutionMode: "AUTO",
    diagnosticExpectedZoneId,
    autoDetectedZoneId: null,
    now,
    metadataTtlSeconds,
  });
}

export function assertAuthorityLineageMatch(
  a: Pick<ActiveMythicPlusSeasonAuthority, "lineage">,
  b: Pick<ActiveMythicPlusSeasonAuthority, "lineage">,
): void {
  const left = a.lineage;
  const right = b.lineage;
  if (
    left.seasonRowId !== right.seasonRowId ||
    left.wclZoneId !== right.wclZoneId ||
    left.dungeonPoolHash !== right.dungeonPoolHash ||
    left.catalogVersion !== right.catalogVersion
  ) {
    throw new Error(
      `ACTIVE_MPLUS_SEASON_LINEAGE_MISMATCH: ${JSON.stringify(left)} vs ${JSON.stringify(right)}`,
    );
  }
}
