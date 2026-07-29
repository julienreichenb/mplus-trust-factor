import type { RaiderIoProvider } from "@mplus/contracts";
import { getEnv, loadEnv } from "@mplus/config";
import { DisabledRaiderIoProvider } from "./disabled-provider.js";
import { FixtureRaiderIoProvider } from "./fixture-provider.js";
import { LiveRaiderIoProvider } from "./live-provider.js";
import { RaiderIoHttpClient } from "./http-client.js";
import type { RaiderIoProviderDeps } from "./provider-base.js";

export function createRaiderIoProvider(mode: "fixture" | "live" = "fixture"): RaiderIoProvider {
  const env = getEnv();

  if (!env.RAIDERIO_ENABLED) {
    return new DisabledRaiderIoProvider();
  }

  const deps: RaiderIoProviderDeps = {
    env: {
      RAIDERIO_CHARACTER_TTL_SECONDS: env.RAIDERIO_CHARACTER_TTL_SECONDS,
      RAIDERIO_NEGATIVE_CACHE_SECONDS: env.RAIDERIO_NEGATIVE_CACHE_SECONDS,
      RAIDERIO_CUTOFFS_TTL_SECONDS: env.RAIDERIO_CUTOFFS_TTL_SECONDS,
      RAIDERIO_STATIC_DATA_TTL_SECONDS: env.RAIDERIO_STATIC_DATA_TTL_SECONDS,
    },
  };

  if (mode === "live") {
    const metrics = undefined;
    const http = new RaiderIoHttpClient({
      baseUrl: env.RAIDERIO_BASE_URL,
      // OpenAPI: access_key query parameter only (never guess Authorization headers).
      appKey: env.RAIDERIO_APP_KEY || undefined,
      softRpm: env.RAIDERIO_SOFT_RPM,
      maxConcurrency: env.RAIDERIO_REQUEST_CONCURRENCY,
    });
    return new LiveRaiderIoProvider({ ...deps, http, metrics });
  }

  return new FixtureRaiderIoProvider(deps);
}

export function createRaiderIoProviderFromEnv(): RaiderIoProvider {
  loadEnv();
  return createRaiderIoProvider(getEnv().PROVIDER_MODE);
}

export { buildMinimalCharacterFields, MINIMAL_CHARACTER_FIELDS } from "./fields.js";
export {
  extractBoostSupportFacts,
  buildAttribution,
  isCrawlStale,
  mapGear,
  mapRanks,
  mapTalents,
} from "./normalize.js";
export { createRpmLimiter } from "./rate-limiter.js";
export { InMemoryProviderCache } from "./cache.js";
export type { RaiderIoCacheStore, RaiderIoCacheEntryMetadata } from "./cache.js";
export { RaiderIoHttpClient } from "./http-client.js";
export { FixtureRaiderIoProvider } from "./fixture-provider.js";
export { LiveRaiderIoProvider } from "./live-provider.js";
export { DisabledRaiderIoProvider } from "./disabled-provider.js";
export type { RaiderIoCapabilities, RaiderIoCapabilityState } from "./capabilities.js";
export {
  RAIDERIO_DOCUMENTED_CURRENT_EXPANSION_ID,
  RAIDERIO_EXPANSION_CATALOG,
  RAIDERIO_EXPANSION_DOCUMENTED_AS_OF,
  RAIDERIO_SCHEMA_VERSION,
} from "./constants.js";
export type { RaiderIoProvider };
export type { RaiderIoMetrics } from "./metrics.js";
