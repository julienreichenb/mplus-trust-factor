import type { BlizzardTokenManager } from "./token-manager.js";
import { ConcurrencyGate, TtlCache } from "./cache.js";
import { mapStatusToError, safeResponseHeaders } from "./errors.js";
import type { BlizzardClientOptions, BlizzardRegionConfig, NamespaceKind } from "./config.js";
import {
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_TTL_SECONDS,
  getRegionConfig,
  namespaceFor,
} from "./config.js";

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
  /** When true, 404/PROFILE_UNAVAILABLE responses are negatively cached. */
  negativeCache?: boolean;
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
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;

  constructor(
    private readonly tokenManager: BlizzardTokenManager,
    options: BlizzardClientOptions = {},
  ) {
    this.now = options.now ?? (() => Date.now());
    this.cache = new TtlCache(this.now);
    this.gate = new ConcurrencyGate(options.concurrency ?? 4);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? ((ms) => sleep(ms));
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
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
      const negative = this.cache.get<{ __negative: true; statusCode: number }>(
        negativeKey(request.fingerprint),
      );
      if (negative?.value.__negative) {
        throw mapStatusToError({
          statusCode: negative.value.statusCode,
          message: `Blizzard ${request.endpointKey} negatively cached (${negative.value.statusCode})`,
          endpointKey: request.endpointKey,
          details: { cacheHit: true },
        });
      }
    }

    return this.cache.dedupe(request.fingerprint, () => this.fetchWithRetry<T>(request));
  }

  private async fetchWithRetry<T>(request: HttpRequestOptions): Promise<HttpSuccess<T>> {
    let retryCount = 0;
    let lastError: unknown;

    while (retryCount < this.maxAttempts) {
      try {
        return await this.gate.run(() => this.doFetch<T>(request, retryCount));
      } catch (error) {
        lastError = error;
        const retryable =
          error instanceof Error &&
          "retryable" in error &&
          Boolean((error as { retryable?: boolean }).retryable);
        if (!retryable || retryCount >= this.maxAttempts - 1) {
          throw error;
        }
        const delayMs = this.backoffMs(retryCount, error);
        await this.sleep(delayMs);
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

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(url.toString(), {
        method: "GET",
        headers,
        signal: controller.signal,
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw mapStatusToError({
          statusCode: null,
          message: `Blizzard ${request.endpointKey} timed out after ${this.timeoutMs}ms`,
          reason: "TIMEOUT",
          endpointKey: request.endpointKey,
        });
      }
      throw mapStatusToError({
        statusCode: null,
        message: `Blizzard network error for ${request.endpointKey}: ${error instanceof Error ? error.message : String(error)}`,
        reason: "TRANSIENT_NETWORK",
        endpointKey: request.endpointKey,
      });
    } finally {
      clearTimeout(timer);
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
      const error = mapStatusToError({
        statusCode: response.status,
        message: `Blizzard ${request.endpointKey} failed with ${response.status}`,
        endpointKey: request.endpointKey,
        details: {
          headers: safeHeaders,
          retryAfter,
        },
      });
      if (
        request.negativeCache !== false &&
        (response.status === 404 || response.status === 400) &&
        !error.retryable
      ) {
        this.cache.set(
          negativeKey(request.fingerprint),
          { __negative: true as const, statusCode: response.status },
          DEFAULT_TTL_SECONDS.negativeCache,
        );
      }
      throw error;
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw mapStatusToError({
        statusCode: response.status,
        message: `Blizzard ${request.endpointKey} returned non-JSON body`,
        reason: "INVALID_PROVIDER_RESPONSE",
        endpointKey: request.endpointKey,
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
      sourceUrl: redactUrl(url).toString(),
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
    const fromHeader = parseRetryAfterMs(details.retryAfter, this.now);
    if (fromHeader !== null) return fromHeader;
    const base = 250 * 2 ** retryCount;
    const jitter = Math.floor(Math.random() * 100);
    return base + jitter;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function negativeKey(fingerprint: string): string {
  return `neg:${fingerprint}`;
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    (typeof DOMException !== "undefined" &&
      error instanceof DOMException &&
      error.name === "AbortError")
  );
}

/** Parse Retry-After as delta-seconds or HTTP-date. */
export function parseRetryAfterMs(
  value: string | null | undefined,
  now: () => number = () => Date.now(),
): number | null {
  if (!value) return null;
  const asNumber = Number(value);
  if (!Number.isNaN(asNumber)) {
    return Math.max(0, asNumber * 1000);
  }
  const asDate = Date.parse(value);
  if (!Number.isNaN(asDate)) {
    return Math.max(0, asDate - now());
  }
  return null;
}

/** Strip any accidental access_token query param from source URLs. */
export function redactUrl(url: URL): URL {
  const copy = new URL(url.toString());
  copy.searchParams.delete("access_token");
  return copy;
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
