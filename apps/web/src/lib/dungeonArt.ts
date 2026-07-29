/**
 * Dungeon card art from Blizzard Game Data:
 * GET /data/wow/media/journal-instance/{id}?namespace=static-eu
 *
 * `tile` assets resolve to public render.worldofwarcraft.com zone images.
 * We prefer the `-large` variant of the same path for run-card quality.
 */

/** Journal instance IDs (static namespace). */
export const JOURNAL_INSTANCE_ID_BY_SLUG: Record<string, number> = {
  "magisters-terrace": 1300,
  "maisara-caverns": 1315,
  "nexus-point-xenas": 1316,
  "nexuspoint-xenas": 1316,
  "windrunner-spire": 1299,
  "algethar-academy": 1201,
  "seat-of-the-triumvirate": 945,
  skyreach: 476,
  "pit-of-saron": 278,
};

/** Zone slug used on render.worldofwarcraft.com (from media tile URLs). */
const ZONE_RENDER_SLUG_BY_DUNGEON_SLUG: Record<string, string> = {
  "magisters-terrace": "magisters-terrace",
  "maisara-caverns": "maisara-caverns",
  "nexus-point-xenas": "nexus-point-xenas",
  "nexuspoint-xenas": "nexus-point-xenas",
  "windrunner-spire": "windrunner-spire",
  "algethar-academy": "algethar-academy",
  "seat-of-the-triumvirate": "seat-of-the-triumvirate",
  skyreach: "skyreach",
  "pit-of-saron": "pit-of-saron",
};

const RENDER_HOST = "https://render.worldofwarcraft.com/eu/zones";

function zoneArtUrl(zoneSlug: string, size: "small" | "large" = "large"): string {
  return `${RENDER_HOST}/${zoneSlug}-${size}.jpg`;
}

export function dungeonBackgroundUrl(dungeonSlug: string | null | undefined): string | null {
  if (!dungeonSlug) return null;
  const key = dungeonSlug.toLowerCase();
  const zoneSlug = ZONE_RENDER_SLUG_BY_DUNGEON_SLUG[key];
  if (!zoneSlug) return null;
  return zoneArtUrl(zoneSlug, "large");
}

export function journalInstanceIdForDungeon(
  dungeonSlug: string | null | undefined,
): number | null {
  if (!dungeonSlug) return null;
  return JOURNAL_INSTANCE_ID_BY_SLUG[dungeonSlug.toLowerCase()] ?? null;
}
