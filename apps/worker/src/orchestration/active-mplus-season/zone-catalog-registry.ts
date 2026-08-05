/**
 * Versioned WCL Mythic+ zone → dungeon catalog registry.
 *
 * Used ONLY by synchronization / repair / regression fixtures to WRITE
 * SeasonDungeon bindings. Production runtime READS persisted bindings only —
 * never this registry as a transparent fallback.
 */
import {
  CURRENT_MPLUS_ZONE_ENCOUNTER_IDS,
  ENCOUNTER_DUNGEON_MAP,
} from "@mplus/provider-warcraftlogs";
import { canonicalDungeonKey } from "../run-fusion.js";

export interface MplusZoneCatalogEntry {
  wclZoneId: number;
  /** Blizzard mythic season id when known for this zone. */
  blizzardSeasonId: number | null;
  expansionIdentity: string | null;
  displayName: string;
  /** Ordered canonical dungeon slugs for the zone. */
  dungeonSlugs: readonly string[];
  /** Parallel WCL encounter ids (same order as dungeonSlugs when known). */
  encounterIds: readonly number[];
}

/**
 * Zone 47 / Midnight Season 1 — regression + sync input only.
 * Do not import this for production runtime dungeon selection.
 */
export const ZONE_47_MIDNIGHT_S1_CATALOG: MplusZoneCatalogEntry = Object.freeze({
  wclZoneId: 47,
  blizzardSeasonId: 17,
  expansionIdentity: "Midnight",
  displayName: "Midnight Season 1 (WCL zone 47)",
  encounterIds: [...CURRENT_MPLUS_ZONE_ENCOUNTER_IDS],
  dungeonSlugs: CURRENT_MPLUS_ZONE_ENCOUNTER_IDS.map(
    (id) => canonicalDungeonKey(ENCOUNTER_DUNGEON_MAP[id]!),
  ),
});

/**
 * Fixture Blizzard season-index (`current_season.id = 13`) + WCL fixture zone 45.
 * Sync/test input only — never a transparent production READ fallback.
 * Pool matches the historical Midnight eight so fixture refresh tests keep a
 * persisted SeasonDungeon catalog after static CURRENT_MPLUS fallback removal.
 */
export const ZONE_45_FIXTURE_SEASON_13_CATALOG: MplusZoneCatalogEntry = Object.freeze({
  wclZoneId: 45,
  blizzardSeasonId: 13,
  expansionIdentity: "Fixture",
  displayName: "Fixture Mythic+ season (Blizzard 13 / WCL zone 45)",
  encounterIds: [...CURRENT_MPLUS_ZONE_ENCOUNTER_IDS],
  dungeonSlugs: CURRENT_MPLUS_ZONE_ENCOUNTER_IDS.map(
    (id) => canonicalDungeonKey(ENCOUNTER_DUNGEON_MAP[id]!),
  ),
});

/** Obsolete TWW fixture pool — must never activate for zone 47. */
export const OBSOLETE_TWW_ZONE_ENCOUNTER_IDS = [
  1201, 1202, 1203, 1204, 1205, 1206, 1207, 1208,
] as const;

export const OBSOLETE_TWW_DUNGEON_SLUGS: readonly string[] = Object.freeze(
  OBSOLETE_TWW_ZONE_ENCOUNTER_IDS.map((id) =>
    canonicalDungeonKey(ENCOUNTER_DUNGEON_MAP[id] ?? `unknown-${id}`),
  ),
);

export type MplusZoneCatalogRegistry = Map<number, MplusZoneCatalogEntry>;

export function createDefaultMplusZoneCatalogRegistry(): MplusZoneCatalogRegistry {
  return new Map([
    [ZONE_47_MIDNIGHT_S1_CATALOG.wclZoneId, ZONE_47_MIDNIGHT_S1_CATALOG],
    [ZONE_45_FIXTURE_SEASON_13_CATALOG.wclZoneId, ZONE_45_FIXTURE_SEASON_13_CATALOG],
  ]);
}

export function registerMplusZoneCatalog(
  registry: MplusZoneCatalogRegistry,
  entry: MplusZoneCatalogEntry,
): void {
  registry.set(entry.wclZoneId, {
    ...entry,
    dungeonSlugs: entry.dungeonSlugs.map((s) => canonicalDungeonKey(s)),
  });
}

export function lookupZoneCatalogByWclZoneId(
  registry: MplusZoneCatalogRegistry,
  wclZoneId: number,
): MplusZoneCatalogEntry | null {
  return registry.get(wclZoneId) ?? null;
}

export function lookupZoneCatalogByBlizzardSeasonId(
  registry: MplusZoneCatalogRegistry,
  blizzardSeasonId: number,
): MplusZoneCatalogEntry[] {
  return [...registry.values()].filter((e) => e.blizzardSeasonId === blizzardSeasonId);
}
