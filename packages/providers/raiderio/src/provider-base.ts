import type {
  CharacterIdentityInput,
  ProviderFetchContext,
  ProviderRequestMetadata,
  ProviderResult,
  RaiderIoCharacterProfile,
  RaiderIoPeriod,
  RaiderIoProvider,
  RaiderIoRunDetails,
  RaiderIoSeasonCutoffs,
  RaiderIoStaticData,
  RegionCode,
} from "@mplus/contracts";
import { ExternalApiError } from "@mplus/contracts";
import { buildRequestFingerprint } from "@mplus/domain";
import type { AppEnv } from "@mplus/config";
import {
  createDefaultCapabilities,
  type RaiderIoCapabilities,
} from "./capabilities.js";
import {
  InMemoryProviderCache,
  type RaiderIoCacheEntryMetadata,
  type RaiderIoCacheStore,
} from "./cache.js";
import {
  RAIDERIO_DOCUMENTED_CURRENT_EXPANSION_ID,
  RAIDERIO_ENDPOINTS,
  RAIDERIO_SCHEMA_VERSION,
} from "./constants.js";
import { selectValidatedExpansionId, type ExpansionResolution } from "./expansion.js";
import { buildMinimalCharacterFields } from "./fields.js";
import type { RaiderIoHttpClient } from "./http-client.js";
import { createMetrics, type RaiderIoMetrics } from "./metrics.js";
import {
  extractRegionFromRunDetails,
  normalizeCharacterProfile,
  normalizePeriods,
  normalizeRunDetails,
  normalizeSeasonCutoffs,
  normalizeStaticData,
  seasonCutoffsHaveAnyThreshold,
  unavailableSeasonCutoffs,
} from "./normalize.js";
import type {
  RawCharacterProfileResponse,
  RawPeriodsResponse,
  RawRunDetailsResponse,
  RawSeasonCutoffsResponse,
  RawStaticDataResponse,
} from "./raw-types.js";
import {
  characterProfileSchema,
  parseWithSchema,
  periodsSchema,
  runDetailsSchema,
  seasonCutoffsSchema,
  staticDataSchema,
} from "./schemas.js";

export interface RaiderIoProviderDeps {
  env: Pick<
    AppEnv,
    | "RAIDERIO_CHARACTER_TTL_SECONDS"
    | "RAIDERIO_NEGATIVE_CACHE_SECONDS"
    | "RAIDERIO_CUTOFFS_TTL_SECONDS"
    | "RAIDERIO_STATIC_DATA_TTL_SECONDS"
  >;
  http?: RaiderIoHttpClient;
  cache?: RaiderIoCacheStore;
  metrics?: RaiderIoMetrics;
  expansionIdOverride?: number;
  loadFixture?: (name: string) => Promise<unknown>;
}

function toRegionQuery(region: RegionCode): string {
  return region.toLowerCase();
}

function buildResult<T>(input: {
  data: T;
  endpointKey: string;
  fingerprint: string;
  ctx: ProviderFetchContext;
  cacheHit: boolean;
  statusCode: number;
  ttlSeconds: number;
  sourceUrl: string | null;
  stale?: boolean;
}): ProviderResult<T> {
  const completedAt = input.ctx.now;
  const expiresAt = new Date(
    new Date(completedAt).getTime() + input.ttlSeconds * 1000,
  ).toISOString();

  const metadata: ProviderRequestMetadata = {
    provider: "raiderio",
    endpointKey: input.endpointKey,
    requestFingerprint: input.fingerprint,
    requestedAt: completedAt,
    completedAt,
    statusCode: input.statusCode,
    cacheHit: input.cacheHit,
    retryCount: 0,
    costUnits: input.cacheHit ? 0 : 1,
    etag: null,
    expiresAt,
  };

  return {
    data: input.data,
    provenance: {
      provider: "raiderio",
      externalRequestId: null,
      sourcePayloadId: null,
      sourceUrl: input.sourceUrl,
      fetchedAt: completedAt,
      schemaVersion: RAIDERIO_SCHEMA_VERSION,
    },
    freshness: {
      fetchedAt: completedAt,
      expiresAt,
      stale: input.stale ?? false,
    },
    metadata,
  };
}

export abstract class BaseRaiderIoProvider implements RaiderIoProvider {
  readonly name = "raiderio" as const;
  readonly enabled: boolean;
  protected readonly cache: RaiderIoCacheStore;
  readonly metrics: RaiderIoMetrics;
  readonly capabilities: RaiderIoCapabilities;
  private expansionResolution: ExpansionResolution | null = null;
  private readonly probedStaticData = new Map<number, RawStaticDataResponse>();

  constructor(
    enabled: boolean,
    protected readonly deps: RaiderIoProviderDeps,
  ) {
    this.enabled = enabled;
    this.cache = deps.cache ?? new InMemoryProviderCache();
    this.metrics = deps.metrics ?? createMetrics();
    this.capabilities = createDefaultCapabilities();
  }

  /** Cache metadata for Agent 15 persistent ExternalRequest integration. */
  describeCacheEntry(
    endpointKey: string,
    region: string,
    queryParams: Record<string, string>,
    ttlSeconds: number,
  ): RaiderIoCacheEntryMetadata {
    return {
      provider: "raiderio",
      endpointKey,
      requestFingerprint: this.fingerprint(endpointKey, region, queryParams),
      ttlSeconds,
      schemaVersion: RAIDERIO_SCHEMA_VERSION,
      queryParams,
      negativeCacheTtlSeconds: this.deps.env.RAIDERIO_NEGATIVE_CACHE_SECONDS,
    };
  }

  getCapabilities(): RaiderIoCapabilities {
    return { ...this.capabilities };
  }

  getExpansionResolution(): ExpansionResolution | null {
    return this.expansionResolution;
  }

  protected assertEnabled(): void {
    if (!this.enabled) {
      throw new ExternalApiError({
        message: "Raider.IO provider is disabled",
        code: "UNKNOWN",
        provider: "raiderio",
        retryable: false,
      });
    }
  }

  protected fingerprint(
    endpointKey: string,
    region: string,
    queryParams: Record<string, string>,
  ): string {
    return buildRequestFingerprint({
      provider: "raiderio",
      region,
      endpointKey,
      pathParams: {},
      queryParams: {
        ...queryParams,
        // Adapter/schema bumps must not reuse prior ExternalPayload cache entries.
        schemaVersion: RAIDERIO_SCHEMA_VERSION,
      },
    });
  }

  async getCharacterProfile(
    identity: CharacterIdentityInput,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<RaiderIoCharacterProfile>> {
    this.assertEnabled();
    const fields = buildMinimalCharacterFields();
    const query = {
      region: toRegionQuery(identity.region),
      realm: identity.realmSlug,
      name: identity.name,
      fields,
    };
    const fingerprint = this.fingerprint(RAIDERIO_ENDPOINTS.characterProfile, identity.region, query);

    if (!ctx.forceRefresh) {
      const cached = this.cache.get<RaiderIoCharacterProfile>(fingerprint);
      if (cached.hit) {
        this.metrics.cacheHits += 1;
        if (cached.negative) this.metrics.negativeCacheHits += 1;
        if (cached.negative) {
          throw new ExternalApiError({
            message: "Raider.IO character not found (negative cache)",
            code: "NOT_FOUND",
            provider: "raiderio",
            retryable: false,
            statusCode: 404,
          });
        }
        return buildResult({
          data: cached.value,
          endpointKey: RAIDERIO_ENDPOINTS.characterProfile,
          fingerprint,
          ctx,
          cacheHit: true,
          statusCode: 200,
          ttlSeconds: this.deps.env.RAIDERIO_CHARACTER_TTL_SECONDS,
          sourceUrl: cached.value.profileUrl,
          stale: cached.value.crawlStale,
        });
      }
    }

    return this.cache.dedupe(fingerprint, async () => {
      this.metrics.cacheMisses += 1;
      try {
        const { raw, statusCode } = await this.fetchCharacterProfile(identity, fields);
        const parsed = parseWithSchema(characterProfileSchema, raw, RAIDERIO_ENDPOINTS.characterProfile);
        if (!parsed.ok) {
          throw new ExternalApiError({
            message: parsed.issues,
            code: "INVALID_RESPONSE",
            provider: "raiderio",
            retryable: false,
            statusCode,
          });
        }
        const data = normalizeCharacterProfile(raw, identity.region, Date.parse(ctx.now));
        this.cache.set(fingerprint, data, this.deps.env.RAIDERIO_CHARACTER_TTL_SECONDS);
        this.metrics.requestsTotal += 1;
        this.capabilities.characterProfile = "available";
        return buildResult({
          data,
          endpointKey: RAIDERIO_ENDPOINTS.characterProfile,
          fingerprint,
          ctx,
          cacheHit: false,
          statusCode,
          ttlSeconds: this.deps.env.RAIDERIO_CHARACTER_TTL_SECONDS,
          sourceUrl: data.profileUrl,
          stale: data.crawlStale,
        });
      } catch (error) {
        if (error instanceof ExternalApiError && error.code === "NOT_FOUND") {
          this.cache.set(
            fingerprint,
            { message: error.message },
            this.deps.env.RAIDERIO_NEGATIVE_CACHE_SECONDS,
            Date.now(),
            true,
          );
          this.capabilities.characterProfile = "available";
        } else if (error instanceof ExternalApiError && error.code === "RATE_LIMITED") {
          this.capabilities.characterProfile = "unavailable";
          this.metrics.rateLimited += 1;
        } else {
          this.capabilities.characterProfile = "unavailable";
        }
        throw error;
      }
    });
  }

  async getSeasonCutoffs(
    region: RegionCode,
    seasonSlug: string,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<RaiderIoSeasonCutoffs>> {
    this.assertEnabled();
    const query = {
      region: toRegionQuery(region),
      season: seasonSlug || undefined,
    };
    const fingerprint = this.fingerprint(RAIDERIO_ENDPOINTS.seasonCutoffs, region, {
      region: query.region,
      season: seasonSlug || "",
    });

    if (!ctx.forceRefresh) {
      const cached = this.cache.get<RaiderIoSeasonCutoffs>(fingerprint);
      if (cached.hit) {
        this.metrics.cacheHits += 1;
        return buildResult({
          data: cached.value,
          endpointKey: RAIDERIO_ENDPOINTS.seasonCutoffs,
          fingerprint,
          ctx,
          cacheHit: true,
          statusCode: 200,
          ttlSeconds: this.deps.env.RAIDERIO_CUTOFFS_TTL_SECONDS,
          sourceUrl: "https://raider.io/mythic-plus/cutoffs",
        });
      }
    }

    return this.cache.dedupe(fingerprint, async () => {
      this.metrics.cacheMisses += 1;
      try {
        const { raw, statusCode } = await this.fetchSeasonCutoffs(region, seasonSlug);
        const parsed = parseWithSchema(seasonCutoffsSchema, raw, RAIDERIO_ENDPOINTS.seasonCutoffs);
        if (!parsed.ok) {
          this.capabilities.seasonCutoffs = "unavailable";
          const data = unavailableSeasonCutoffs(region, seasonSlug);
          this.cache.set(fingerprint, data, Math.min(900, this.deps.env.RAIDERIO_CUTOFFS_TTL_SECONDS));
          return buildResult({
            data,
            endpointKey: RAIDERIO_ENDPOINTS.seasonCutoffs,
            fingerprint,
            ctx,
            cacheHit: false,
            statusCode,
            ttlSeconds: Math.min(900, this.deps.env.RAIDERIO_CUTOFFS_TTL_SECONDS),
            sourceUrl: "https://raider.io/mythic-plus/cutoffs",
            stale: true,
          });
        }
        const data = normalizeSeasonCutoffs(raw, region, seasonSlug);
        this.cache.set(fingerprint, data, this.deps.env.RAIDERIO_CUTOFFS_TTL_SECONDS);
        this.metrics.requestsTotal += 1;
        this.capabilities.seasonCutoffs = seasonCutoffsHaveAnyThreshold(data)
          ? "available"
          : "unavailable";
        return buildResult({
          data,
          endpointKey: RAIDERIO_ENDPOINTS.seasonCutoffs,
          fingerprint,
          ctx,
          cacheHit: false,
          statusCode,
          ttlSeconds: this.deps.env.RAIDERIO_CUTOFFS_TTL_SECONDS,
          sourceUrl: "https://raider.io/mythic-plus/cutoffs",
        });
      } catch (error) {
        // Optional endpoint: never block character refresh on cutoffs outages (observed HTTP 500).
        this.capabilities.seasonCutoffs = "unavailable";
        if (error instanceof ExternalApiError && error.code === "RATE_LIMITED") {
          this.metrics.rateLimited += 1;
        }
        const data = unavailableSeasonCutoffs(region, seasonSlug);
        this.cache.set(fingerprint, data, 900);
        this.metrics.requestsTotal += 1;
        return buildResult({
          data,
          endpointKey: RAIDERIO_ENDPOINTS.seasonCutoffs,
          fingerprint,
          ctx,
          cacheHit: false,
          statusCode: error instanceof ExternalApiError ? (error.statusCode ?? 500) : 500,
          ttlSeconds: 900,
          sourceUrl: "https://raider.io/mythic-plus/cutoffs",
          stale: true,
        });
      }
    });
  }

  async getStaticData(ctx: ProviderFetchContext): Promise<ProviderResult<RaiderIoStaticData>> {
    this.assertEnabled();
    const resolution = await this.resolveExpansion(ctx);
    const expansionId = String(resolution.expansionId);
    const query = { expansion_id: expansionId };
    const fingerprint = this.fingerprint(RAIDERIO_ENDPOINTS.staticData, "global", query);

    if (!ctx.forceRefresh) {
      const cached = this.cache.get<RaiderIoStaticData>(fingerprint);
      if (cached.hit) {
        this.metrics.cacheHits += 1;
        return buildResult({
          data: cached.value,
          endpointKey: RAIDERIO_ENDPOINTS.staticData,
          fingerprint,
          ctx,
          cacheHit: true,
          statusCode: 200,
          ttlSeconds: this.deps.env.RAIDERIO_STATIC_DATA_TTL_SECONDS,
          sourceUrl: "https://raider.io/api",
          stale: resolution.pinStale,
        });
      }
    }

    return this.cache.dedupe(fingerprint, async () => {
      this.metrics.cacheMisses += 1;
      try {
        const probed = this.probedStaticData.get(resolution.expansionId);
        const fetched = probed
          ? { raw: probed, statusCode: 200 }
          : await this.fetchStaticData(resolution.expansionId);
        const { raw, statusCode } = fetched;
        this.probedStaticData.set(resolution.expansionId, raw);
        const parsed = parseWithSchema(staticDataSchema, raw, RAIDERIO_ENDPOINTS.staticData);
        if (!parsed.ok) {
          throw new ExternalApiError({
            message: parsed.issues,
            code: "INVALID_RESPONSE",
            provider: "raiderio",
            retryable: false,
            statusCode,
          });
        }
        const data = normalizeStaticData(raw, resolution.expansionId, Date.parse(ctx.now));
        this.cache.set(fingerprint, data, this.deps.env.RAIDERIO_STATIC_DATA_TTL_SECONDS);
        if (!probed) this.metrics.requestsTotal += 1;
        this.capabilities.staticData = "available";
        return buildResult({
          data,
          endpointKey: RAIDERIO_ENDPOINTS.staticData,
          fingerprint,
          ctx,
          cacheHit: Boolean(probed),
          statusCode,
          ttlSeconds: this.deps.env.RAIDERIO_STATIC_DATA_TTL_SECONDS,
          sourceUrl: "https://raider.io/api",
          stale: resolution.pinStale,
        });
      } catch (error) {
        this.capabilities.staticData = "unavailable";
        throw error;
      }
    });
  }

  async getRunDetails(
    seasonSlug: string,
    externalRunId: string,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<RaiderIoRunDetails>> {
    this.assertEnabled();
    const query = { season: seasonSlug, id: externalRunId };
    const fingerprint = this.fingerprint(RAIDERIO_ENDPOINTS.runDetails, ctx.region, query);

    if (!ctx.forceRefresh) {
      const cached = this.cache.get<RaiderIoRunDetails>(fingerprint);
      if (cached.hit) {
        this.metrics.cacheHits += 1;
        return buildResult({
          data: cached.value,
          endpointKey: RAIDERIO_ENDPOINTS.runDetails,
          fingerprint,
          ctx,
          cacheHit: true,
          statusCode: 200,
          ttlSeconds: this.deps.env.RAIDERIO_CHARACTER_TTL_SECONDS,
          sourceUrl: cached.value.profileUrl,
        });
      }
    }

    return this.cache.dedupe(fingerprint, async () => {
      this.metrics.cacheMisses += 1;
      try {
        const { raw, statusCode } = await this.fetchRunDetails(seasonSlug, externalRunId, ctx.region);
        const parsed = parseWithSchema(runDetailsSchema, raw, RAIDERIO_ENDPOINTS.runDetails);
        if (!parsed.ok) {
          throw new ExternalApiError({
            message: parsed.issues,
            code: "INVALID_RESPONSE",
            provider: "raiderio",
            retryable: false,
            statusCode,
          });
        }
        const region = extractRegionFromRunDetails(raw, ctx.region);
        const data = normalizeRunDetails(raw, region);
        this.cache.set(fingerprint, data, this.deps.env.RAIDERIO_CHARACTER_TTL_SECONDS);
        this.metrics.requestsTotal += 1;
        this.capabilities.runDetails = "available";
        return buildResult({
          data,
          endpointKey: RAIDERIO_ENDPOINTS.runDetails,
          fingerprint,
          ctx,
          cacheHit: false,
          statusCode,
          ttlSeconds: this.deps.env.RAIDERIO_CHARACTER_TTL_SECONDS,
          sourceUrl: data.profileUrl,
        });
      } catch (error) {
        this.capabilities.runDetails = "unavailable";
        throw error;
      }
    });
  }

  async getPeriods(ctx: ProviderFetchContext): Promise<ProviderResult<RaiderIoPeriod[]>> {
    this.assertEnabled();
    const fingerprint = this.fingerprint(RAIDERIO_ENDPOINTS.periods, "global", {});

    if (!ctx.forceRefresh) {
      const cached = this.cache.get<RaiderIoPeriod[]>(fingerprint);
      if (cached.hit) {
        this.metrics.cacheHits += 1;
        return buildResult({
          data: cached.value,
          endpointKey: RAIDERIO_ENDPOINTS.periods,
          fingerprint,
          ctx,
          cacheHit: true,
          statusCode: 200,
          ttlSeconds: this.deps.env.RAIDERIO_STATIC_DATA_TTL_SECONDS,
          sourceUrl: "https://raider.io/api",
        });
      }
    }

    return this.cache.dedupe(fingerprint, async () => {
      this.metrics.cacheMisses += 1;
      try {
        const { raw, statusCode } = await this.fetchPeriods();
        const parsed = parseWithSchema(periodsSchema, raw, RAIDERIO_ENDPOINTS.periods);
        if (!parsed.ok) {
          throw new ExternalApiError({
            message: parsed.issues,
            code: "INVALID_RESPONSE",
            provider: "raiderio",
            retryable: false,
            statusCode,
          });
        }
        const data = normalizePeriods(raw.periods ?? []);
        this.cache.set(fingerprint, data, this.deps.env.RAIDERIO_STATIC_DATA_TTL_SECONDS);
        this.metrics.requestsTotal += 1;
        this.capabilities.periods = "available";
        return buildResult({
          data,
          endpointKey: RAIDERIO_ENDPOINTS.periods,
          fingerprint,
          ctx,
          cacheHit: false,
          statusCode,
          ttlSeconds: this.deps.env.RAIDERIO_STATIC_DATA_TTL_SECONDS,
          sourceUrl: "https://raider.io/api",
        });
      } catch (error) {
        this.capabilities.periods = "unavailable";
        throw error;
      }
    });
  }

  protected async resolveExpansion(ctx: ProviderFetchContext): Promise<ExpansionResolution> {
    if (this.expansionResolution && !ctx.forceRefresh) {
      return this.expansionResolution;
    }

    this.expansionResolution = await selectValidatedExpansionId({
      overrideId: this.deps.expansionIdOverride,
      nowMs: Date.parse(ctx.now),
      probe: async (expansionId) => {
        const cachedProbe = this.probedStaticData.get(expansionId);
        if (cachedProbe) return cachedProbe;
        try {
          const { raw } = await this.fetchStaticData(expansionId);
          this.probedStaticData.set(expansionId, raw);
          this.metrics.requestsTotal += 1;
          return raw;
        } catch {
          return null;
        }
      },
    });

    return this.expansionResolution;
  }

  protected abstract fetchCharacterProfile(
    identity: CharacterIdentityInput,
    fields: string,
  ): Promise<{ raw: RawCharacterProfileResponse; statusCode: number }>;

  protected abstract fetchSeasonCutoffs(
    region: RegionCode,
    seasonSlug: string,
  ): Promise<{ raw: RawSeasonCutoffsResponse; statusCode: number }>;

  protected abstract fetchStaticData(
    expansionId?: number,
  ): Promise<{ raw: RawStaticDataResponse; statusCode: number }>;

  protected abstract fetchRunDetails(
    seasonSlug: string,
    externalRunId: string,
    region: RegionCode,
  ): Promise<{ raw: RawRunDetailsResponse; statusCode: number }>;

  protected abstract fetchPeriods(): Promise<{ raw: RawPeriodsResponse; statusCode: number }>;
}

export { RAIDERIO_DOCUMENTED_CURRENT_EXPANSION_ID };
