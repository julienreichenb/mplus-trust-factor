/**
 * Strong catalog readiness — SeasonDungeon count alone is never enough.
 */
import type { PrismaClient, Season } from "@mplus/database";
import { canonicalDungeonKey } from "../run-fusion.js";
import { readActiveMplusCatalogMetadata } from "./catalog-metadata.js";
import { computeDungeonPoolHash } from "./types.js";
import { loadSeasonDungeonIdentities } from "./resolve.js";

export interface CatalogReadinessResult {
  ready: boolean;
  reasons: string[];
  wclZoneId: number | null;
  blizzardSeasonId: number | null;
  dungeonPoolHash: string | null;
  dungeonCount: number;
  expectedDungeonCount: number | null;
}

/**
 * A catalog is ready only when persisted state is coherent and lastKnownGood.
 */
export async function evaluateSeasonCatalogReadiness(
  prisma: PrismaClient,
  season: Pick<
    Season,
    "id" | "slug" | "blizzardSeasonId" | "dungeonCount" | "metadata"
  >,
  opts: { requireEncounterIds?: boolean } = {},
): Promise<CatalogReadinessResult> {
  const reasons: string[] = [];
  const requireEncounterIds = opts.requireEncounterIds !== false;
  const meta = readActiveMplusCatalogMetadata(season.metadata);

  if (!meta) {
    reasons.push("missing_active_mplus_catalog_metadata");
  } else {
    if (meta.lastKnownGood !== true) reasons.push("lastKnownGood_false");
    if (!Number.isInteger(meta.wclZoneId) || meta.wclZoneId <= 0) {
      reasons.push("invalid_wclZoneId");
    }
    if (meta.dungeonSlugs.length === 0) reasons.push("metadata_dungeonSlugs_empty");
  }

  const dungeons = await loadSeasonDungeonIdentities(prisma, season.id);
  if (dungeons.length === 0) {
    reasons.push("season_dungeon_bindings_empty");
  }

  const expected =
    meta?.dungeonSlugs.length && meta.dungeonSlugs.length > 0
      ? meta.dungeonSlugs.length
      : season.dungeonCount > 0
        ? season.dungeonCount
        : null;

  if (expected == null || expected <= 0) {
    reasons.push("expected_dungeon_count_missing");
  } else if (dungeons.length !== expected) {
    reasons.push(
      `season_dungeon_count_mismatch:bindings=${dungeons.length}:expected=${expected}`,
    );
  }

  const bindingSlugs = dungeons.map((d) => canonicalDungeonKey(d.slug));
  const unique = new Set(bindingSlugs);
  if (unique.size !== bindingSlugs.length) {
    reasons.push("duplicate_dungeon_slugs");
  }

  if (meta && meta.dungeonSlugs.length > 0) {
    const metaSlugs = meta.dungeonSlugs.map((s) => canonicalDungeonKey(s));
    if (metaSlugs.join("\n") !== bindingSlugs.join("\n")) {
      reasons.push("metadata_dungeonSlugs_mismatch_bindings");
    }
    const poolHash = computeDungeonPoolHash(bindingSlugs);
    if (poolHash !== meta.dungeonPoolHash) {
      reasons.push("dungeon_pool_hash_mismatch");
    }
  }

  if (requireEncounterIds) {
    const missing = dungeons.filter(
      (d) => d.wclEncounterId == null || !Number.isFinite(d.wclEncounterId) || d.wclEncounterId <= 0,
    );
    if (missing.length > 0) {
      reasons.push(`missing_wcl_encounter_ids:${missing.map((d) => d.slug).join(",")}`);
    }
  }

  if (
    meta?.blizzardSeasonId != null &&
    season.blizzardSeasonId != null &&
    meta.blizzardSeasonId !== season.blizzardSeasonId
  ) {
    reasons.push("blizzard_season_id_mismatch");
  }

  const poolHash =
    bindingSlugs.length > 0 ? computeDungeonPoolHash(bindingSlugs) : meta?.dungeonPoolHash ?? null;

  return {
    ready: reasons.length === 0,
    reasons,
    wclZoneId: meta?.wclZoneId ?? null,
    blizzardSeasonId: meta?.blizzardSeasonId ?? season.blizzardSeasonId ?? null,
    dungeonPoolHash: poolHash,
    dungeonCount: dungeons.length,
    expectedDungeonCount: expected,
  };
}

export async function isSeasonCatalogReady(
  prisma: PrismaClient,
  season: Pick<Season, "id" | "slug" | "blizzardSeasonId" | "dungeonCount" | "metadata">,
): Promise<boolean> {
  return (await evaluateSeasonCatalogReadiness(prisma, season)).ready;
}
