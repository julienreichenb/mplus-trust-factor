import type { RegionCode } from "@mplus/contracts";

export type BlizzardRegionKey = "eu" | "us" | "kr" | "tw";

export interface BlizzardRegionConfig {
  key: BlizzardRegionKey;
  regionCode: RegionCode;
  apiHost: string;
  profileNamespace: string;
  dynamicNamespace: string;
  staticNamespace: string;
  defaultLocale: string;
}

export const BLIZZARD_REGIONS: Record<BlizzardRegionKey, BlizzardRegionConfig> = {
  eu: {
    key: "eu",
    regionCode: "EU",
    apiHost: "https://eu.api.blizzard.com",
    profileNamespace: "profile-eu",
    dynamicNamespace: "dynamic-eu",
    staticNamespace: "static-eu",
    defaultLocale: "en_GB",
  },
  us: {
    key: "us",
    regionCode: "US",
    apiHost: "https://us.api.blizzard.com",
    profileNamespace: "profile-us",
    dynamicNamespace: "dynamic-us",
    staticNamespace: "static-us",
    defaultLocale: "en_US",
  },
  kr: {
    key: "kr",
    regionCode: "KR",
    apiHost: "https://kr.api.blizzard.com",
    profileNamespace: "profile-kr",
    dynamicNamespace: "dynamic-kr",
    staticNamespace: "static-kr",
    defaultLocale: "ko_KR",
  },
  tw: {
    key: "tw",
    regionCode: "TW",
    apiHost: "https://tw.api.blizzard.com",
    profileNamespace: "profile-tw",
    dynamicNamespace: "dynamic-tw",
    staticNamespace: "static-tw",
    defaultLocale: "zh_TW",
  },
};

export const OAUTH_TOKEN_URL = "https://oauth.battle.net/token";
export const SCHEMA_VERSION = "blizzard-wow-profile-2026-07";
export const TOKEN_SAFETY_WINDOW_MS = 60_000;

export const DEFAULT_TTL_SECONDS = {
  characterProfile: 86_400,
  characterEquipment: 21_600,
  characterSpecializations: 21_600,
  characterMedia: 86_400,
  characterAchievements: 86_400,
  characterMplusIndex: 21_600,
  characterMplusSeasonCurrent: 21_600,
  characterMplusSeasonHistorical: 2_592_000,
  realm: 604_800,
  seasonIndex: 86_400,
  seasonHistorical: 2_592_000,
  dungeon: 604_800,
  item: 604_800,
  playableSpec: 604_800,
  leaderboard: 3_600,
  negativeCache: 1_800,
} as const;

export type NamespaceKind = "profile" | "dynamic" | "static";

export function resolveRegionKey(region: string | undefined, fallback: BlizzardRegionKey = "eu"): BlizzardRegionKey {
  const normalized = (region ?? fallback).trim().toLowerCase();
  if (normalized in BLIZZARD_REGIONS) {
    return normalized as BlizzardRegionKey;
  }
  throw new Error(`Unsupported Blizzard region: ${region}`);
}

export function getRegionConfig(region: string | undefined, fallback: BlizzardRegionKey = "eu"): BlizzardRegionConfig {
  return BLIZZARD_REGIONS[resolveRegionKey(region, fallback)];
}

export function namespaceFor(region: BlizzardRegionConfig, kind: NamespaceKind): string {
  if (kind === "profile") return region.profileNamespace;
  if (kind === "dynamic") return region.dynamicNamespace;
  return region.staticNamespace;
}

export interface BlizzardClientOptions {
  clientId?: string;
  clientSecret?: string;
  defaultRegion?: BlizzardRegionKey;
  defaultLocale?: string;
  concurrency?: number;
  /** Per-request timeout in milliseconds (default 15s). */
  timeoutMs?: number;
  /** Max HTTP attempts including the first try (default 3). */
  maxAttempts?: number;
  characterTtlSeconds?: number;
  fixtureDir?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  logger?: {
    debug?: (obj: Record<string, unknown>, msg?: string) => void;
    info?: (obj: Record<string, unknown>, msg?: string) => void;
    warn?: (obj: Record<string, unknown>, msg?: string) => void;
    error?: (obj: Record<string, unknown>, msg?: string) => void;
  };
}

export const DEFAULT_TIMEOUT_MS = 15_000;
export const DEFAULT_MAX_ATTEMPTS = 3;
