/**
 * Provider-free diagnostic of persisted seasons / dungeon bindings / manifests.
 * Does not mutate data. Does not call WCL.
 */
import type { PrismaClient } from "@mplus/database";
import {
  MIDNIGHT_SEASON_1_DUNGEON_SLUGS,
  containsObsoleteDungeonSlug,
  dungeonPoolEqualsExpected,
  normalizeCanaryDungeonSlug,
} from "./canary-catalog.js";

export interface SeasonCatalogDiagnosticRow {
  seasonId: string;
  seasonSlug: string;
  seasonName: string;
  blizzardSeasonId: number | null;
  regionId: string | null;
  isCurrent: boolean;
  dungeonCountField: number;
  linkedDungeonSlugs: string[];
  obsoleteLinkedSlugs: string[];
  matchesMidnightSeason1Pool: boolean;
  manifestCount: number;
  latestManifestId: string | null;
  latestManifestFrozenAt: string | null;
  latestManifestDungeonSlugs: string[];
  latestManifestStalePool: boolean;
  recommendation:
    | "ok"
    | "invalidate_or_recreate_manifest"
    | "repair_season_dungeon_bindings"
    | "review_season_authority";
}

export interface SeasonCatalogDiagnosticReport {
  schemaVersion: "scoring-v2-canary-season-catalog-diagnostic-v1";
  providerCalls: 0;
  expectedMidnightSlugs: readonly string[];
  seasons: SeasonCatalogDiagnosticRow[];
  staleManifestsRequireInvalidation: boolean;
}

export async function diagnoseSeasonCatalog(
  prisma: PrismaClient,
): Promise<SeasonCatalogDiagnosticReport> {
  const seasons = await prisma.season.findMany({
    orderBy: [{ isCurrent: "desc" }, { updatedAt: "desc" }],
    include: {
      seasonDungeons: {
        include: { dungeon: true },
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  const rows: SeasonCatalogDiagnosticRow[] = [];
  let staleManifestsRequireInvalidation = false;

  for (const season of seasons) {
    const linkedDungeonSlugs = season.seasonDungeons.map((sd) =>
      normalizeCanaryDungeonSlug(sd.dungeon.slug),
    );
    const obsoleteLinkedSlugs = containsObsoleteDungeonSlug(linkedDungeonSlugs);
    const matchesMidnightSeason1Pool = dungeonPoolEqualsExpected(
      linkedDungeonSlugs,
      MIDNIGHT_SEASON_1_DUNGEON_SLUGS,
    );

    const manifests = await prisma.evidenceManifest.findMany({
      where: { seasonId: season.id },
      orderBy: { frozenAt: "desc" },
      take: 5,
      include: {
        slots: { include: { dungeon: true } },
      },
    });
    const latest = manifests[0] ?? null;
    const latestManifestDungeonSlugs = latest
      ? [
          ...new Set(
            latest.slots.map((s) => normalizeCanaryDungeonSlug(s.dungeon.slug)),
          ),
        ].sort()
      : [];
    const latestManifestStalePool =
      latestManifestDungeonSlugs.length > 0 &&
      (containsObsoleteDungeonSlug(latestManifestDungeonSlugs).length > 0 ||
        !dungeonPoolEqualsExpected(
          latestManifestDungeonSlugs,
          MIDNIGHT_SEASON_1_DUNGEON_SLUGS,
        ));

    if (latestManifestStalePool) staleManifestsRequireInvalidation = true;

    let recommendation: SeasonCatalogDiagnosticRow["recommendation"] = "ok";
    if (latestManifestStalePool) {
      recommendation = "invalidate_or_recreate_manifest";
    } else if (obsoleteLinkedSlugs.length > 0 || !matchesMidnightSeason1Pool) {
      recommendation =
        linkedDungeonSlugs.length === 0
          ? "repair_season_dungeon_bindings"
          : "review_season_authority";
    }

    rows.push({
      seasonId: season.id,
      seasonSlug: season.slug,
      seasonName: season.name,
      blizzardSeasonId: season.blizzardSeasonId,
      regionId: season.regionId,
      isCurrent: season.isCurrent,
      dungeonCountField: season.dungeonCount,
      linkedDungeonSlugs,
      obsoleteLinkedSlugs,
      matchesMidnightSeason1Pool,
      manifestCount: await prisma.evidenceManifest.count({
        where: { seasonId: season.id },
      }),
      latestManifestId: latest?.id ?? null,
      latestManifestFrozenAt: latest?.frozenAt.toISOString() ?? null,
      latestManifestDungeonSlugs,
      latestManifestStalePool,
      recommendation,
    });
  }

  return {
    schemaVersion: "scoring-v2-canary-season-catalog-diagnostic-v1",
    providerCalls: 0,
    expectedMidnightSlugs: MIDNIGHT_SEASON_1_DUNGEON_SLUGS,
    seasons: rows,
    staleManifestsRequireInvalidation,
  };
}
