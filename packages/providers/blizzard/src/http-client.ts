import type { BlizzardTokenManager } from "./token-manager.js";
import { ConcurrencyGate, TtlCache } from "./cache.js";
import { mapStatusToError, safeResponseHeaders } from "./errors.js";
import type { BlizzardClientOptions, BlizzardRegionConfig, NamespaceKind } from "./config.js";
import { getRegionConfig, namespaceFor } from "./config.js";

export interface HttpRequestOptions {
  regionConfig: BlizzardRegionConfig;
  namespaceKind: NamespaceKind;
  path: string;
  endpointKey: string;
  fingerprint: string;
  ttlSeconds: number;
  forceRefresh?: boolean;
  locale?: string;
  extraQuery?: Record<string, string>;
}

export interface HttpSuccess<T> {
  data: T;
  statusCode: number;
  cacheHit: boolean;
  etag: string | null;
  lastModified: string | null;
  sourceUrl: string;
  expiresAt: string;
  retryCount: number;
  headers: Record<string, string>;
}

export class BlizzardHttpClient {
  private readonly cache: TtlCache;
  private readonly gate: ConcurrencyGate;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(
    private readonly tokenManager: BlizzardTokenManager,
    options: BlizzardClientOptions = {},
  ) {
    this.now = options.now ?? (() => Date.now());
    this.cache = new TtlCache(this.now);
    this.gate = new ConcurrencyGate(options.concurrency ?? 4);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  getCache(): TtlCache {
    return this.cache;
  }

  async getJson<T>(request: HttpRequestOptions): Promise<HttpSuccess<T>> {
    if (!request.forceRefresh) {
      const cached = this.cache.get<T>(request.fingerprint);
      if (cached) {
        return {
          data: cached.value,
          statusCode: 200,
          cacheHit: true,
          etag: cached.etag,
          lastModified: cached.lastModified,
          sourceUrl: this.buildUrl(request).toString(),
          expiresAt: new Date(cached.expiresAtMs).toISOString(),
          retryCount: 0,
          headers: {},
        };
      }
    }

    return this.cache.dedupe(request.fingerprint, () => this.fetchWithRetry<T>(request));
  }

  private async fetchWithRetry<T>(request: HttpRequestOptions): Promise<HttpSuccess<T>> {
    const maxAttempts = 3;
    let retryCount = 0;
    let lastError: unknown;

    while (retryCount < maxAttempts) {
      try {
        return await this.gate.run(() => this.doFetch<T>(request, retryCount));
      } catch (error) {
        lastError = error;
        const retryable =
          error instanceof Error &&
          "retryable" in error &&
          Boolean((error as { retryable?: boolean }).retryable);
        if (!retryable || retryCount >= maxAttempts - 1) {
          throw error;
        }
        const delayMs = this.backoffMs(retryCount, error);
        await sleep(delayMs, this.now);
        retryCount += 1;
      }
    }

    throw lastError;
  }

  private async doFetch<T>(request: HttpRequestOptions, retryCount: number): Promise<HttpSuccess<T>> {
    const url = this.buildUrl(request);
    const token = await this.tokenManager.getAccessToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    };

    const prior = this.cache.get<T>(request.fingerprint);
    if (prior?.etag) headers["If-None-Match"] = prior.etag;
    if (prior?.lastModified) headers["If-Modified-Since"] = prior.lastModified;

    let response: Response;
    try {
      response = await this.fetchImpl(url.toString(), { method: "GET", headers });
    } catch (error) {
      throw mapStatusToError({
        statusCode: null,
        message: `Blizzard network error for ${request.endpointKey}: ${error instanceof Error ? error.message : String(error)}`,
        reason: "TRANSIENT_NETWORK",
      });
    }

    if (response.status === 304 && prior) {
      this.cache.set(request.fingerprint, prior.value, request.ttlSeconds, {
        etag: prior.etag,
        lastModified: prior.lastModified,
      });
      return {
        data: prior.value,
        statusCode: 304,
        cacheHit: true,
        etag: prior.etag,
        lastModified: prior.lastModified,
        sourceUrl: url.toString(),
        expiresAt: new Date(this.now() + request.ttlSeconds * 1000).toISOString(),
        retryCount,
        headers: safeResponseHeaders(response.headers),
      };
    }

    if (!response.ok) {
      const safeHeaders = safeResponseHeaders(response.headers);
      const retryAfter = response.headers.get("retry-after");
      throw mapStatusToError({
        statusCode: response.status,
        message: `Blizzard ${request.endpointKey} failed with ${response.status}`,
        reason:
          response.status === 404
            ? "NOT_FOUND"
            : response.status === 429
              ? "RATE_LIMITED"
              : response.status === 403
                ? "PRIVATE_OR_RESTRICTED"
                : response.status === 401
                  ? "UNAUTHORIZED_PROVIDER"
                  : response.status >= 500
                    ? "PROVIDER_UNAVAILABLE"
                    : "INVALID_PROVIDER_RESPONSE",
        details: {
          headers: safeHeaders,
          retryAfter,
          endpointKey: request.endpointKey,
        },
      });
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw mapStatusToError({
        statusCode: response.status,
        message: `Blizzard ${request.endpointKey} returned non-JSON body`,
        reason: "INVALID_PROVIDER_RESPONSE",
      });
    }

    const etag = response.headers.get("etag");
    const lastModified = response.headers.get("last-modified");
    const expiresAtMs = this.now() + request.ttlSeconds * 1000;
    this.cache.set(request.fingerprint, json as T, request.ttlSeconds, { etag, lastModified });

    return {
      data: json as T,
      statusCode: response.status,
      cacheHit: false,
      etag,
      lastModified,
      sourceUrl: url.toString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
      retryCount,
      headers: safeResponseHeaders(response.headers),
    };
  }

  private buildUrl(request: HttpRequestOptions): URL {
    const url = new URL(request.path, `${request.regionConfig.apiHost}/`);
    url.searchParams.set("namespace", namespaceFor(request.regionConfig, request.namespaceKind));
    url.searchParams.set("locale", request.locale ?? request.regionConfig.defaultLocale);
    if (request.extraQuery) {
      for (const [key, value] of Object.entries(request.extraQuery)) {
        url.searchParams.set(key, value);
      }
    }
    return url;
  }

  private backoffMs(retryCount: number, error: unknown): number {
    const details =
      error && typeof error === "object" && "details" in error
        ? ((error as { details?: { retryAfter?: string } }).details ?? {})
        : {};
    if (details.retryAfter) {
      const asNumber = Number(details.retryAfter);
      if (!Number.isNaN(asNumber)) return Math.max(0, asNumber * 1000);
    }
    const base = 250 * 2 ** retryCount;
    const jitter = Math.floor(Math.random() * 100);
    return base + jitter;
  }
}

function sleep(ms: number, now: () => number): Promise<void> {
  // Prefer real timers; tests can inject fake timers via vitest.
  void now;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function regionFromContext(
  region: string,
  defaultRegion: string,
  defaultLocale?: string,
): BlizzardRegionConfig {
  const config = getRegionConfig(region || defaultRegion, defaultRegion as "eu");
  if (defaultLocale) {
    return { ...config, defaultLocale };
  }
  return config;
}
