export const RAIDERIO_SCHEMA_VERSION = "0.62.5";

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

/** The War Within expansion id per OpenAPI static-data docs. */
export const RAIDERIO_DEFAULT_EXPANSION_ID = 10;

export const DEFAULT_NEGATIVE_CACHE_SECONDS = 2700;
export const DEFAULT_CUTOFFS_TTL_SECONDS = 86_400;
export const DEFAULT_STATIC_DATA_TTL_SECONDS = 604_800;
