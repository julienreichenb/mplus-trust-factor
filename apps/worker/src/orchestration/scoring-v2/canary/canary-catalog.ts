/**
 * Authoritative WCL zone ↔ Mythic+ season dungeon catalog for Scoring V2 canary.
 *
 * Zone 47 = Midnight Season 1. Do not use obsolete TWW fixture pools.
 */
import {
  CURRENT_MPLUS_ZONE_DUNGEON_SLUGS,
} from "@mplus/provider-warcraftlogs";
import { normalizeDungeonSlug } from "@mplus/scoring";
import { canonicalDungeonKey } from "../../run-fusion.js";

export const MIDNIGHT_SEASON_1_WCL_ZONE_ID = 47;
export const MIDNIGHT_SEASON_1_PRODUCT_SLUG = "midnight-season-1";
export const MIDNIGHT_SEASON_1_BLIZZARD_SEASON_ID = 17;
export const MIDNIGHT_SEASON_1_EXPANSION = "Midnight";
export const EXPECTED_ACTIVE_DUNGEON_COUNT = 8;

/** Canonical Midnight Season 1 dungeon slugs (WCL zone 47). */
export const MIDNIGHT_SEASON_1_DUNGEON_SLUGS: readonly string[] = Object.freeze(
  [...CURRENT_MPLUS_ZONE_DUNGEON_SLUGS]
    .map((s) => canonicalDungeonKey(s))
    .sort(),
);

/** Obsolete TWW / fixture pool — must never appear for zone 47 canaries. */
export const OBSOLETE_TWW_DUNGEON_SLUGS: readonly string[] = Object.freeze(
  [
    "ara-kara-city-of-echoes",
    "eco-dome-aldani",
    "eco-dome-al'dani",
    "halls-of-atonement",
    "operation-floodgate",
    "priory-of-the-sacred-flame",
    "tazavesh-streets-of-wonder",
    "the-dawnbreaker",
    "the-rookery",
  ].map((s) => canonicalDungeonKey(s)),
);

const OBSOLETE_SET = new Set(OBSOLETE_TWW_DUNGEON_SLUGS);
const EXPECTED_SET = new Set(MIDNIGHT_SEASON_1_DUNGEON_SLUGS);

export function expectedDungeonSlugsForWclZone(zoneId: number): readonly string[] | null {
  if (zoneId === MIDNIGHT_SEASON_1_WCL_ZONE_ID) {
    return MIDNIGHT_SEASON_1_DUNGEON_SLUGS;
  }
  return null;
}

export function normalizeCanaryDungeonSlug(slug: string): string {
  return canonicalDungeonKey(normalizeDungeonSlug(slug));
}

export function containsObsoleteDungeonSlug(slugs: readonly string[]): string[] {
  return [
    ...new Set(
      slugs
        .map(normalizeCanaryDungeonSlug)
        .filter((s) => OBSOLETE_SET.has(s)),
    ),
  ].sort();
}

export function dungeonPoolEqualsExpected(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  const a = new Set(actual.map(normalizeCanaryDungeonSlug));
  const e = new Set(expected.map(normalizeCanaryDungeonSlug));
  if (a.size !== e.size) return false;
  for (const slug of e) {
    if (!a.has(slug)) return false;
  }
  return true;
}

export function assertMidnightSeason1PoolForZone47(input: {
  zoneId: number;
  dungeonSlugs: readonly string[];
}): { ok: true } | { ok: false; code: "SEASON_CATALOG_MISMATCH"; reasons: string[] } {
  const reasons: string[] = [];
  if (input.zoneId !== MIDNIGHT_SEASON_1_WCL_ZONE_ID) {
    reasons.push(
      `configuredZoneId=${input.zoneId} is not Midnight Season 1 WCL zone ${MIDNIGHT_SEASON_1_WCL_ZONE_ID}`,
    );
  }
  const obsolete = containsObsoleteDungeonSlug(input.dungeonSlugs);
  if (obsolete.length > 0) {
    reasons.push(`obsolete_dungeon_slugs:${obsolete.join(",")}`);
  }
  if (input.dungeonSlugs.length !== EXPECTED_ACTIVE_DUNGEON_COUNT) {
    reasons.push(
      `dungeonCount=${input.dungeonSlugs.length} expected=${EXPECTED_ACTIVE_DUNGEON_COUNT}`,
    );
  }
  if (!dungeonPoolEqualsExpected(input.dungeonSlugs, MIDNIGHT_SEASON_1_DUNGEON_SLUGS)) {
    const missing = MIDNIGHT_SEASON_1_DUNGEON_SLUGS.filter(
      (s) => !new Set(input.dungeonSlugs.map(normalizeCanaryDungeonSlug)).has(s),
    );
    const unexpected = input.dungeonSlugs
      .map(normalizeCanaryDungeonSlug)
      .filter((s) => !EXPECTED_SET.has(s));
    if (missing.length) reasons.push(`missing_dungeons:${missing.join(",")}`);
    if (unexpected.length) reasons.push(`unexpected_dungeons:${unexpected.join(",")}`);
  }
  if (reasons.length > 0) {
    return { ok: false, code: "SEASON_CATALOG_MISMATCH", reasons };
  }
  return { ok: true };
}

export function seasonLooksLikeMidnightSeason1(season: {
  slug: string;
  name: string;
  blizzardSeasonId: number | null;
}): boolean {
  if (season.blizzardSeasonId === MIDNIGHT_SEASON_1_BLIZZARD_SEASON_ID) return true;
  const hay = `${season.slug} ${season.name}`.toLowerCase();
  return (
    hay.includes("midnight") ||
    season.slug === MIDNIGHT_SEASON_1_PRODUCT_SLUG ||
    season.slug === `blizzard-season-${MIDNIGHT_SEASON_1_BLIZZARD_SEASON_ID}`
  );
}
