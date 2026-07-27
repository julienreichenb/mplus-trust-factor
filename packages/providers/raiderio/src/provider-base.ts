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
import { InMemoryProviderCache } from "./cache.js";
import { RAIDERIO_ENDPOINTS, RAIDERIO_SCHEMA_VERSION } from "./constants.js";
import { buildMinimalCharacterFields } from "./fields.js";
import type { RaiderIoHttpClient } from "./http-client.js";
import { createMetrics, type RaiderIoMetrics } from "./metrics.js";
import {
  normalizeCharacterProfile,
  normalizePeriods,
  normalizeRunDetails,
  normalizeSeasonCutoffs,
  normalizeStaticData,
} from "./normalize.js";
import type {
  RawCharacterProfileResponse,
  RawPeriodsResponse,
  RawRunDetailsResponse,
  RawSeasonCutoffsResponse,
  RawStaticDataResponse,
} from "./raw-types.js";
import { RAIDERIO_DEFAULT_EXPANSION_ID } from "./constants.js";

export interface RaiderIoProviderDeps {
  env: Pick<
    AppEnv,
    | "RAIDERIO_CHARACTER_TTL_SECONDS"
    | "RAIDERIO_NEGATIVE_CACHE_SECONDS"
    | "RAIDERIO_CUTOFFS_TTL_SECONDS"
    | "RAIDERIO_STATIC_DATA_TTL_SECONDS"
  >;
  http?: RaiderIoHttpClient;
  cache?: InMemoryProviderCache;
  metrics?: RaiderIoMetrics;
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
      stale: false,
    },
    metadata,
  };
}

export abstract class BaseRaiderIoProvider implements RaiderIoProvider {
  readonly name = "raiderio" as const;
  readonly enabled: boolean;
  protected readonly cache: InMemoryProviderCache;
  readonly metrics: RaiderIoMetrics;

  constructor(
    enabled: boolean,
    protected readonly deps: RaiderIoProviderDeps,
  ) {
    this.enabled = enabled;
    this.cache = deps.cache ?? new InMemoryProviderCache();
    this.metrics = deps.metrics ?? createMetrics();
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
      queryParams,
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
        return buildResult({
          data: cached.value,
          endpointKey: RAIDERIO_ENDPOINTS.characterProfile,
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
      const { raw, statusCode } = await this.fetchCharacterProfile(identity, fields);
      const data = normalizeCharacterProfile(raw, identity.region);
      this.cache.set(fingerprint, data, this.deps.env.RAIDERIO_CHARACTER_TTL_SECONDS);
      this.metrics.requestsTotal += 1;
      return buildResult({
        data,
        endpointKey: RAIDERIO_ENDPOINTS.characterProfile,
        fingerprint,
        ctx,
        cacheHit: false,
        statusCode,
        ttlSeconds: this.deps.env.RAIDERIO_CHARACTER_TTL_SECONDS,
        sourceUrl: data.profileUrl,
      });
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
      const { raw, statusCode } = await this.fetchSeasonCutoffs(region, seasonSlug);
      const data = normalizeSeasonCutoffs(raw, region, seasonSlug);
      this.cache.set(fingerprint, data, this.deps.env.RAIDERIO_CUTOFFS_TTL_SECONDS);
      this.metrics.requestsTotal += 1;
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
    });
  }

  async getStaticData(ctx: ProviderFetchContext): Promise<ProviderResult<RaiderIoStaticData>> {
    this.assertEnabled();
    const expansionId = String(RAIDERIO_DEFAULT_EXPANSION_ID);
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
        });
      }
    }

    return this.cache.dedupe(fingerprint, async () => {
      this.metrics.cacheMisses += 1;
      const { raw, statusCode } = await this.fetchStaticData();
      const data = normalizeStaticData(raw, RAIDERIO_DEFAULT_EXPANSION_ID);
      this.cache.set(fingerprint, data, this.deps.env.RAIDERIO_STATIC_DATA_TTL_SECONDS);
      this.metrics.requestsTotal += 1;
      return buildResult({
        data,
        endpointKey: RAIDERIO_ENDPOINTS.staticData,
        fingerprint,
        ctx,
        cacheHit: false,
        statusCode,
        ttlSeconds: this.deps.env.RAIDERIO_STATIC_DATA_TTL_SECONDS,
        sourceUrl: "https://raider.io/api",
      });
    });
  }

  async getRunDetails(
    seasonSlug: string,
    externalRunId: string,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<RaiderIoRunDetails>> {
    this.assertEnabled();
    const query = { season: seasonSlug, id: externalRunId };
    const fingerprint = this.fingerprint(RAIDERIO_ENDPOINTS.runDetails, "global", query);

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
      const { raw, statusCode, region } = await this.fetchRunDetails(seasonSlug, externalRunId);
      const data = normalizeRunDetails(raw, region);
      this.cache.set(fingerprint, data, this.deps.env.RAIDERIO_CHARACTER_TTL_SECONDS);
      this.metrics.requestsTotal += 1;
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
      const { raw, statusCode } = await this.fetchPeriods();
      const data = normalizePeriods(raw.periods ?? []);
      this.cache.set(fingerprint, data, this.deps.env.RAIDERIO_STATIC_DATA_TTL_SECONDS);
      this.metrics.requestsTotal += 1;
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
    });
  }

  protected abstract fetchCharacterProfile(
    identity: CharacterIdentityInput,
    fields: string,
  ): Promise<{ raw: RawCharacterProfileResponse; statusCode: number }>;

  protected abstract fetchSeasonCutoffs(
    region: RegionCode,
    seasonSlug: string,
  ): Promise<{ raw: RawSeasonCutoffsResponse; statusCode: number }>;

  protected abstract fetchStaticData(): Promise<{ raw: RawStaticDataResponse; statusCode: number }>;

  protected abstract fetchRunDetails(
    seasonSlug: string,
    externalRunId: string,
  ): Promise<{ raw: RawRunDetailsResponse; statusCode: number; region: RegionCode }>;

  protected abstract fetchPeriods(): Promise<{ raw: RawPeriodsResponse; statusCode: number }>;

  protected cacheNegative(fingerprint: string, error: ExternalApiError): never {
    if (error.code === "NOT_FOUND") {
      this.cache.set(
        fingerprint,
        { message: error.message },
        this.deps.env.RAIDERIO_NEGATIVE_CACHE_SECONDS,
        Date.now(),
        true,
      );
      this.metrics.negativeCacheHits += 1;
    }
    throw error;
  }
}
