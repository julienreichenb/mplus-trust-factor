import { ExternalApiError } from "@mplus/contracts";
import { createRpmLimiter, type TokenBucketRateLimiter } from "./rate-limiter.js";

export interface RaiderIoHttpResponse<T> {
  statusCode: number;
  headers: Headers;
  body: T;
}

export interface RaiderIoHttpClientOptions {
  baseUrl: string;
  appKey?: string;
  softRpm: number;
  maxConcurrency: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export class RaiderIoHttpClient {
  private readonly rateLimiter: TokenBucketRateLimiter;
  private activeRequests = 0;
  private readonly waitQueue: Array<() => void> = [];
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: RaiderIoHttpClientOptions) {
    this.rateLimiter = createRpmLimiter(options.softRpm);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep =
      options.sleep ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  private async acquireSlot(): Promise<void> {
    if (this.activeRequests < this.options.maxConcurrency) {
      this.activeRequests += 1;
      return;
    }
    await new Promise<void>((resolve) => {
      this.waitQueue.push(() => {
        this.activeRequests += 1;
        resolve();
      });
    });
  }

  private releaseSlot(): void {
    this.activeRequests -= 1;
    const next = this.waitQueue.shift();
    if (next) next();
  }

  private buildUrl(path: string, query: Record<string, string | undefined>): string {
    const url = new URL(path, this.options.baseUrl);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== "") {
        url.searchParams.set(key, value);
      }
    }
    if (this.options.appKey) {
      url.searchParams.set("access_key", this.options.appKey);
    }
    return url.toString();
  }

  async getJson<T>(
    path: string,
    query: Record<string, string | undefined>,
    endpointKey: string,
  ): Promise<RaiderIoHttpResponse<T>> {
    const maxRetries = this.options.maxRetries ?? 3;
    let attempt = 0;
    let lastError: unknown;

    while (attempt <= maxRetries) {
      while (!this.rateLimiter.tryAcquire()) {
        await this.sleep(50);
      }

      await this.acquireSlot();
      try {
        const url = this.buildUrl(path, query);
        const response = await this.fetchImpl(url, {
          method: "GET",
          headers: { Accept: "application/json" },
        });

        if (response.status === 429) {
          const retryAfter = response.headers.get("Retry-After");
          const waitMs = retryAfter ? Number.parseInt(retryAfter, 10) * 1000 : 2 ** attempt * 250;
          const jitter = Math.floor(Math.random() * 100);
          if (attempt >= maxRetries) {
            throw new ExternalApiError({
              message: `Raider.IO rate limited on ${endpointKey}`,
              code: "RATE_LIMITED",
              provider: "raiderio",
              retryable: true,
              statusCode: 429,
              details: { retryAfter },
            });
          }
          await this.sleep(waitMs + jitter);
          attempt += 1;
          continue;
        }

        const text = await response.text();
        let body: T;
        try {
          body = text ? (JSON.parse(text) as T) : ({} as T);
        } catch {
          throw new ExternalApiError({
            message: `Invalid JSON from Raider.IO ${endpointKey}`,
            code: "INVALID_RESPONSE",
            provider: "raiderio",
            retryable: false,
            statusCode: response.status,
          });
        }

        if (response.status === 404) {
          throw new ExternalApiError({
            message: `Raider.IO resource not found for ${endpointKey}`,
            code: "NOT_FOUND",
            provider: "raiderio",
            retryable: false,
            statusCode: 404,
            details: body,
          });
        }

        if (!response.ok) {
          throw new ExternalApiError({
            message: `Raider.IO HTTP ${response.status} on ${endpointKey}`,
            code: "UNKNOWN",
            provider: "raiderio",
            retryable: response.status >= 500,
            statusCode: response.status,
            details: body,
          });
        }

        return { statusCode: response.status, headers: response.headers, body };
      } catch (error) {
        lastError = error;
        if (error instanceof ExternalApiError) {
          if (!error.retryable || attempt >= maxRetries) throw error;
        } else if (attempt >= maxRetries) {
          throw new ExternalApiError({
            message: `Raider.IO network error on ${endpointKey}`,
            code: "NETWORK",
            provider: "raiderio",
            retryable: true,
            details: error,
          });
        }
        const backoff = 2 ** attempt * 200 + Math.floor(Math.random() * 100);
        await this.sleep(backoff);
        attempt += 1;
      } finally {
        this.releaseSlot();
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new ExternalApiError({
          message: `Raider.IO request failed for ${endpointKey}`,
          code: "UNKNOWN",
          provider: "raiderio",
          retryable: false,
        });
  }
}
