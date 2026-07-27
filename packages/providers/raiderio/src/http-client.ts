import { ExternalApiError } from "@mplus/contracts";
import { RAIDERIO_DEFAULT_TIMEOUT_MS } from "./constants.js";
import { createRpmLimiter, type TokenBucketRateLimiter } from "./rate-limiter.js";

export interface RaiderIoHttpResponse<T> {
  statusCode: number;
  headers: Headers;
  body: T;
}

export interface RaiderIoHttpClientOptions {
  baseUrl: string;
  /** Optional app key. OpenAPI documents this as query param `access_key` only. */
  appKey?: string;
  softRpm: number;
  maxConcurrency: number;
  maxRetries?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  onRateLimited?: () => void;
}

function isNotFoundBody(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const message = String((body as { message?: unknown }).message ?? "").toLowerCase();
  return message.includes("could not find requested character") || message.includes("not found");
}

export class RaiderIoHttpClient {
  private readonly rateLimiter: TokenBucketRateLimiter;
  private activeRequests = 0;
  private readonly waitQueue: Array<() => void> = [];
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly timeoutMs: number;

  constructor(private readonly options: RaiderIoHttpClientOptions) {
    this.rateLimiter = createRpmLimiter(options.softRpm);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep =
      options.sleep ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.timeoutMs = options.timeoutMs ?? RAIDERIO_DEFAULT_TIMEOUT_MS;
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

  /**
   * Builds request URLs. `RAIDERIO_APP_KEY` is transmitted only as OpenAPI `access_key` query param.
   * Do not invent Authorization headers.
   */
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

  private async fetchWithTimeout(url: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && (error.name === "AbortError" || /aborted/i.test(error.message))) {
        throw new ExternalApiError({
          message: `Raider.IO request timed out after ${this.timeoutMs}ms`,
          code: "TIMEOUT",
          provider: "raiderio",
          retryable: true,
        });
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
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
        const response = await this.fetchWithTimeout(url);

        if (response.status === 429) {
          this.options.onRateLimited?.();
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
            details: { bodyPreview: text.slice(0, 200) },
          });
        }

        // Live API returns HTTP 400 (not 404) for missing characters.
        if (response.status === 404 || (response.status === 400 && isNotFoundBody(body))) {
          throw new ExternalApiError({
            message: `Raider.IO resource not found for ${endpointKey}`,
            code: "NOT_FOUND",
            provider: "raiderio",
            retryable: false,
            statusCode: response.status,
            details: body,
          });
        }

        if (!response.ok) {
          throw new ExternalApiError({
            message: `Raider.IO HTTP ${response.status} on ${endpointKey}`,
            code: response.status >= 500 ? "UNKNOWN" : "INVALID_RESPONSE",
            provider: "raiderio",
            retryable: response.status >= 500,
            statusCode: response.status,
            details: body,
          });
        }

        return { statusCode: response.status, headers: response.headers, body };
      } catch (error: unknown) {
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
