import type { AbilityCatalogVersion } from "./types.js";

/** Retail Midnight Season 1 catalog pin used by the current registry. */
export const CATALOG_GAME_VERSION = "12.0.0";
export const CATALOG_SEASON_SLUG = "midnight-season-1";
export const CATALOG_VERIFIED_AT = "2026-07-28";
export const CATALOG_GENERATED_AT = "2026-07-28T12:00:00.000Z";
export const CATALOG_SOURCE_SNAPSHOT = "retail-midnight-s1-curated-2026-07-28";

export const CURRENT_CATALOG_VERSION: AbilityCatalogVersion = {
  gameVersion: CATALOG_GAME_VERSION,
  seasonSlug: CATALOG_SEASON_SLUG,
  generatedAt: CATALOG_GENERATED_AT,
  sourceSnapshot: CATALOG_SOURCE_SNAPSHOT,
};

export const CURRENT_CATALOG_VERSION_ID = `${CATALOG_GAME_VERSION}/${CATALOG_SEASON_SLUG}`;

/** Historical catalog pins retained for score reproducibility. */
export const HISTORICAL_CATALOG_VERSIONS: AbilityCatalogVersion[] = [
  CURRENT_CATALOG_VERSION,
  {
    gameVersion: "11.1.0",
    seasonSlug: "tww-season-2",
    generatedAt: "2025-06-01T00:00:00.000Z",
    sourceSnapshot: "warlock-demonology-tww-1",
  },
];
