export const RAIDERIO_SCHEMA_VERSION = "0.62.5+cutoffs-v2";

export const RAIDERIO_ENDPOINTS = {
  characterProfile: "characters.profile",
  seasonCutoffs: "mythic-plus.season-cutoffs",
  staticData: "mythic-plus.static-data",
  runDetails: "mythic-plus.run-details",
  periods: "periods",
} as const;

export const RAIDERIO_ATTRIBUTION = {
  provider: "raiderio" as const,
  displayText: "Data from Raider.IO" as const,
  homepageUrl: "https://raider.io" as const,
};

/**
 * Expansion IDs from OpenAPI v0.62.5 `mythic-plus/static-data` docs.
 * Prefer dynamic resolution via `resolveExpansionId`; do not treat this as timeless.
 */
export const RAIDERIO_EXPANSION_CATALOG = [
  { id: 11, name: "Midnight", openApiLabel: "Midnight" },
  { id: 10, name: "The War Within", openApiLabel: "TheWarWithin" },
  { id: 9, name: "Dragonflight", openApiLabel: "Dragonflight" },
  { id: 8, name: "Shadowlands", openApiLabel: "Shadowlands" },
  { id: 7, name: "Battle for Azeroth", openApiLabel: "BattleForAzeroth" },
  { id: 6, name: "Legion", openApiLabel: "Legion" },
] as const;

/** Highest OpenAPI-documented expansion as of the pin date below. */
export const RAIDERIO_DOCUMENTED_CURRENT_EXPANSION_ID = 11;

/** ISO date when the expansion catalog / current id were verified against swagger.json. */
export const RAIDERIO_EXPANSION_DOCUMENTED_AS_OF = "2026-07-27";

/** Warn when documented expansion pin is older than this many days. */
export const RAIDERIO_EXPANSION_PIN_MAX_AGE_DAYS = 120;

/** Crawl older than this is labelled stale on normalized profiles. */
export const RAIDERIO_STALE_CRAWL_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

export const RAIDERIO_DEFAULT_TIMEOUT_MS = 10_000;

export const DEFAULT_NEGATIVE_CACHE_SECONDS = 2700;
export const DEFAULT_CUTOFFS_TTL_SECONDS = 86_400;
export const DEFAULT_STATIC_DATA_TTL_SECONDS = 604_800;
