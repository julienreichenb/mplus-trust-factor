/**
 * Resolve the persisted application season + dungeon pool for a canary zone.
 * Provider-free: PostgreSQL + static CURRENT_MPLUS_ZONE_DUNGEON_SLUGS only.
 */
import type { PrismaClient, Season } from "@mplus/database";
import {
  readBlizzardSeasonDungeonSlugsFromMetadata,
  resolveActiveSeasonDungeonPool,
  type ActiveSeasonDungeonPoolSource,
} from "@mplus/scoring";
import { CURRENT_MPLUS_ZONE_DUNGEON_SLUGS } from "@mplus/provider-warcraftlogs";
import { canonicalDungeonKey } from "../../run-fusion.js";
import {
  EXPECTED_ACTIVE_DUNGEON_COUNT,
  MIDNIGHT_SEASON_1_EXPANSION,
  MIDNIGHT_SEASON_1_PRODUCT_SLUG,
  MIDNIGHT_SEASON_1_WCL_ZONE_ID,
  assertMidnightSeason1PoolForZone47,
  normalizeCanaryDungeonSlug,
  seasonLooksLikeMidnightSeason1,
} from "./canary-catalog.js";

export type SeasonValidationStatus =
  | "OK"
  | "SEASON_NOT_FOUND"
  | "SEASON_CATALOG_MISMATCH"
  | "ZONE_UNSUPPORTED";

export interface CanarySeasonDungeonRow {
  slug: string;
  dungeonId: string;
  journalInstanceId: number | null;
  wclZoneOrEncounterId: string | null;
  sortOrder: number;
}

export interface CanarySeasonResolution {
  configuredZoneId: number;
  seasonId: string | null;
  seasonSlug: string | null;
  seasonName: string | null;
  blizzardSeasonId: number | null;
  expansion: string | null;
  productSeasonSlug: string | null;
  catalogSource: ActiveSeasonDungeonPoolSource | "none";
  catalogVersion: string;
  dungeonCount: number;
  dungeons: CanarySeasonDungeonRow[];
  activeDungeonSlugs: string[];
  validationStatus: SeasonValidationStatus;
  validationReasons: string[];
  isCurrent: boolean | null;
  startsAt: string | null;
  endsAt: string | null;
}

export class SeasonCatalogMismatchError extends Error {
  readonly code = "SEASON_CATALOG_MISMATCH" as const;
  readonly seasonResolution: CanarySeasonResolution;

  constructor(resolution: CanarySeasonResolution) {
    super(
      `SEASON_CATALOG_MISMATCH: ${resolution.validationReasons.join("; ") || "catalog mismatch"}`,
    );
    this.name = "SeasonCatalogMismatchError";
    this.seasonResolution = resolution;
  }
}

function catalogVersionLabel(source: ActiveSeasonDungeonPoolSource | "none"): string {
  return `active-season-pool:${source}:zone-${MIDNIGHT_SEASON_1_WCL_ZONE_ID}`;
}

export async function resolveCanarySeasonCatalog(input: {
  prisma: PrismaClient;
  regionId: string;
  configuredZoneId: number;
}): Promise<CanarySeasonResolution> {
  if (input.configuredZoneId !== MIDNIGHT_SEASON_1_WCL_ZONE_ID) {
    return {
      configuredZoneId: input.configuredZoneId,
      seasonId: null,
      seasonSlug: null,
      seasonName: null,
      blizzardSeasonId: null,
      expansion: null,
      productSeasonSlug: null,
      catalogSource: "none",
      catalogVersion: catalogVersionLabel("none"),
      dungeonCount: 0,
      dungeons: [],
      activeDungeonSlugs: [],
      validationStatus: "ZONE_UNSUPPORTED",
      validationReasons: [
        `Canary catalog validation currently supports WCL zone ${MIDNIGHT_SEASON_1_WCL_ZONE_ID} only`,
      ],
      isCurrent: null,
      startsAt: null,
      endsAt: null,
    };
  }

  // Prefer authoritative Midnight Season 1 over placeholder/auto-current rows
  // that may also be marked isCurrent in local seeds.
  const season =
    (await input.prisma.season.findFirst({
      where: {
        regionId: input.regionId,
        OR: [
          { blizzardSeasonId: 17 },
          { slug: "blizzard-season-17" },
          { slug: MIDNIGHT_SEASON_1_PRODUCT_SLUG },
        ],
      },
      orderBy: [{ isCurrent: "desc" }, { updatedAt: "desc" }],
    })) ??
    (await input.prisma.season.findFirst({
      where: { regionId: input.regionId, isCurrent: true },
      orderBy: { updatedAt: "desc" },
    })) ??
    (await input.prisma.season.findFirst({
      where: { regionId: null, isCurrent: true },
      orderBy: { updatedAt: "desc" },
    }));

  if (!season) {
    return emptyResolution(input.configuredZoneId, "SEASON_NOT_FOUND", [
      "No persisted current/Midnight Season 1 row for region",
    ]);
  }

  return buildResolutionFromSeason(input.prisma, input.configuredZoneId, season);
}

async function buildResolutionFromSeason(
  prisma: PrismaClient,
  configuredZoneId: number,
  season: Season,
): Promise<CanarySeasonResolution> {
  const seasonDungeonRows = await prisma.seasonDungeon.findMany({
    where: { seasonId: season.id },
    include: { dungeon: true },
    orderBy: { sortOrder: "asc" },
  });

  const expectedCount =
    season.dungeonCount > 0 ? season.dungeonCount : EXPECTED_ACTIVE_DUNGEON_COUNT;
  const blizzardSlugs = readBlizzardSeasonDungeonSlugsFromMetadata(season.metadata);
  const pool = resolveActiveSeasonDungeonPool({
    expectedDungeonCount: expectedCount,
    seasonDungeonSlugs: seasonDungeonRows.map((row) =>
      canonicalDungeonKey(row.dungeon.slug),
    ),
    blizzardSeasonDungeonSlugs: blizzardSlugs.map(canonicalDungeonKey),
    // Static fallback is Midnight zone-47 pool — never the obsolete TWW list.
    raiderioDungeonSlugs: CURRENT_MPLUS_ZONE_DUNGEON_SLUGS.map(canonicalDungeonKey),
  });

  const dungeons: CanarySeasonDungeonRow[] = seasonDungeonRows.map((row) => ({
    slug: normalizeCanaryDungeonSlug(row.dungeon.slug),
    dungeonId: row.dungeon.id,
    journalInstanceId: null,
    wclZoneOrEncounterId:
      row.dungeon.wclZoneOrEncounterId != null
        ? String(row.dungeon.wclZoneOrEncounterId)
        : null,
    sortOrder: row.sortOrder,
  }));

  // When DB bindings are empty, surface the resolved static pool for reporting.
  const activeDungeonSlugs =
    pool.canonicalSlugs.length > 0
      ? pool.canonicalSlugs.map(normalizeCanaryDungeonSlug)
      : [];

  const midnightOk = seasonLooksLikeMidnightSeason1(season);
  const poolCheck = assertMidnightSeason1PoolForZone47({
    zoneId: configuredZoneId,
    dungeonSlugs: activeDungeonSlugs,
  });

  const validationReasons: string[] = [];
  if (!midnightOk) {
    validationReasons.push(
      `season_identity_not_midnight: slug=${season.slug} blizzardSeasonId=${season.blizzardSeasonId ?? "null"}`,
    );
  }
  if (!poolCheck.ok) {
    validationReasons.push(...poolCheck.reasons);
  }

  const validationStatus: SeasonValidationStatus =
    validationReasons.length > 0 ? "SEASON_CATALOG_MISMATCH" : "OK";

  return {
    configuredZoneId,
    seasonId: season.id,
    seasonSlug: season.slug,
    seasonName: season.name,
    blizzardSeasonId: season.blizzardSeasonId,
    expansion: midnightOk ? MIDNIGHT_SEASON_1_EXPANSION : null,
    productSeasonSlug: MIDNIGHT_SEASON_1_PRODUCT_SLUG,
    catalogSource: pool.source,
    catalogVersion: catalogVersionLabel(pool.source),
    dungeonCount: activeDungeonSlugs.length,
    dungeons:
      dungeons.length > 0
        ? dungeons
        : activeDungeonSlugs.map((slug, i) => ({
            slug,
            dungeonId: "",
            journalInstanceId: null,
            wclZoneOrEncounterId: null,
            sortOrder: i,
          })),
    activeDungeonSlugs,
    validationStatus,
    validationReasons,
    isCurrent: season.isCurrent,
    startsAt: season.startsAt?.toISOString() ?? null,
    endsAt: season.endsAt?.toISOString() ?? null,
  };
}

function emptyResolution(
  configuredZoneId: number,
  status: SeasonValidationStatus,
  reasons: string[],
): CanarySeasonResolution {
  return {
    configuredZoneId,
    seasonId: null,
    seasonSlug: null,
    seasonName: null,
    blizzardSeasonId: null,
    expansion: null,
    productSeasonSlug: MIDNIGHT_SEASON_1_PRODUCT_SLUG,
    catalogSource: "none",
    catalogVersion: catalogVersionLabel("none"),
    dungeonCount: 0,
    dungeons: [],
    activeDungeonSlugs: [],
    validationStatus: status,
    validationReasons: reasons,
    isCurrent: null,
    startsAt: null,
    endsAt: null,
  };
}

export function assertSeasonCatalogOk(
  resolution: CanarySeasonResolution,
): asserts resolution is CanarySeasonResolution & {
  validationStatus: "OK";
  seasonId: string;
  seasonSlug: string;
} {
  if (resolution.validationStatus !== "OK" || !resolution.seasonId || !resolution.seasonSlug) {
    throw new SeasonCatalogMismatchError(resolution);
  }
}
