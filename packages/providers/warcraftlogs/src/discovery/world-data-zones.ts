/**
 * WCL WorldData zones — discover the active Mythic+ zone catalog.
 * Selection is semantic (Keystone / non-frozen / encounters). Never Math.max(id).
 */
import { z } from "zod";
import { ENCOUNTER_DUNGEON_MAP } from "./run-discovery.js";
import { slugifyDungeonName } from "./dungeon-slug.js";

export const wclWorldDataEncounterSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  journalID: z.number().int().nullable().optional(),
});

export const wclWorldDataZoneSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  frozen: z.boolean(),
  expansion: z
    .object({
      id: z.number().int().nullable().optional(),
      name: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  /** Live WCL returns a Bracket object (not an array). Opaque — selection uses name/frozen/encounters. */
  brackets: z.unknown().optional(),
  encounters: z.array(wclWorldDataEncounterSchema).default([]),
});

export const wclWorldDataZonesResponseSchema = z.object({
  worldData: z
    .object({
      zones: z.array(wclWorldDataZoneSchema).nullable().optional(),
    })
    .nullable()
    .optional(),
});

export type WclWorldDataEncounter = z.infer<typeof wclWorldDataEncounterSchema>;
export type WclWorldDataZone = z.infer<typeof wclWorldDataZoneSchema>;

export const WORLD_DATA_ZONES_QUERY = `query WorldDataZones {
  worldData {
    zones {
      id
      name
      frozen
      expansion { id name }
      brackets { type }
      encounters { id name }
    }
  }
}`;

/** True when the zone name indicates Mythic+ / Keystone (not raid). */
export function isMythicPlusZoneName(name: string): boolean {
  const n = name.trim().toLowerCase();
  if (!n) return false;
  if (/\braid\b/.test(n) && !/\b(keystone|mythic\+?|mythic\s*plus|m\+)\b/.test(n)) {
    return false;
  }
  return (
    /\bkeystone\b/.test(n) ||
    /\bmythic\s*\+\b/.test(n) ||
    /\bmythic\s*plus\b/.test(n) ||
    /\bm\+\b/.test(n) ||
    n.includes("mythic+")
  );
}

export type SelectActiveMythicPlusZoneResult =
  | { kind: "ok"; zone: WclWorldDataZone }
  | { kind: "none" }
  | { kind: "ambiguous"; candidates: WclWorldDataZone[] };

/**
 * Select the single active Mythic+ zone from WorldData.
 * Never picks by max(zoneId) or array order alone.
 */
export function selectActiveMythicPlusZone(
  zones: readonly WclWorldDataZone[],
): SelectActiveMythicPlusZoneResult {
  const candidates = zones.filter(
    (z) => !z.frozen && isMythicPlusZoneName(z.name) && z.encounters.length > 0,
  );
  if (candidates.length === 0) return { kind: "none" };
  if (candidates.length === 1) return { kind: "ok", zone: candidates[0]! };
  return { kind: "ambiguous", candidates };
}

export function parseWorldDataZonesPayload(raw: unknown): WclWorldDataZone[] {
  const parsed = wclWorldDataZonesResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw Object.assign(new Error(`Invalid WorldData zones payload: ${parsed.error.message}`), {
      code: "WCL_WORLD_DATA_ZONES_SCHEMA_INVALID",
    });
  }
  return parsed.data.worldData?.zones ?? [];
}

export interface DiscoveredMplusCatalogEntry {
  wclZoneId: number;
  blizzardSeasonId: number;
  expansionIdentity: string | null;
  displayName: string;
  dungeonSlugs: string[];
  encounterIds: number[];
}

/**
 * Build a catalog entry from a validated WCL zone + Blizzard season id.
 * Prefer ENCOUNTER_DUNGEON_MAP; fall back to encounter name slug.
 */
export function buildMplusCatalogEntryFromZone(
  zone: WclWorldDataZone,
  blizzardSeasonId: number,
): DiscoveredMplusCatalogEntry {
  const dungeonSlugs: string[] = [];
  const encounterIds: number[] = [];
  const seen = new Set<string>();

  for (const encounter of zone.encounters) {
    const mapped = ENCOUNTER_DUNGEON_MAP[encounter.id];
    const rawSlug = mapped ?? slugifyDungeonName(encounter.name);
    const slug = slugifyDungeonName(rawSlug) || rawSlug;
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    dungeonSlugs.push(slug);
    encounterIds.push(encounter.id);
  }

  if (dungeonSlugs.length === 0) {
    throw Object.assign(
      new Error(
        `ACTIVE_MPLUS_SEASON_CATALOG_INCOMPLETE: zone ${zone.id} produced empty dungeon pool`,
      ),
      { code: "ACTIVE_MPLUS_SEASON_CATALOG_INCOMPLETE" },
    );
  }

  return {
    wclZoneId: zone.id,
    blizzardSeasonId,
    expansionIdentity: zone.expansion?.name?.trim() || null,
    displayName: zone.name.trim(),
    dungeonSlugs,
    encounterIds,
  };
}
