# Raider.IO cache and rate policy (Wave 3)

## Internal soft budget

| Setting | Default | Env var |
|---------|---------|---------|
| Soft RPM | 60 | `RAIDERIO_SOFT_RPM` |
| Concurrency | 2 | `RAIDERIO_REQUEST_CONCURRENCY` |
| Timeout | 10s | provider default (`RAIDERIO_DEFAULT_TIMEOUT_MS`) |
| Character TTL | 12 hours | `RAIDERIO_CHARACTER_TTL_SECONDS` |
| Negative cache | 45 minutes | `RAIDERIO_NEGATIVE_CACHE_SECONDS` |
| Cutoffs TTL | 24 hours | `RAIDERIO_CUTOFFS_TTL_SECONDS` |
| Static data TTL | 7 days | `RAIDERIO_STATIC_DATA_TTL_SECONDS` |

Official unauthenticated limit: **200 req/min** (we stay well below at 60).

## Rate limiting implementation

- Token bucket (`createRpmLimiter`) per HTTP client
- Concurrency semaphore (max 2 in-flight)
- On HTTP 429: honor `Retry-After`, exponential backoff with jitter, max 3 retries
- Timeout via `AbortController` → `TIMEOUT` (retryable)

## Caching implementation

- Default: in-memory `RaiderIoCacheStore` keyed by `buildRequestFingerprint`
- In-flight dedupe for identical concurrent requests
- Negative cache for missing characters (45 min default)
- `forceRefresh` on `ProviderFetchContext` bypasses positive cache
- `describeCacheEntry()` exposes fingerprint, TTL, schema version and query params for Agent 15 persistent `ExternalRequest` wiring

## Capability state

`getCapabilities()` reports per-endpoint `available | unavailable | unknown`.
`seasonCutoffs` is set to `unavailable` on 5xx/parse failure without throwing to callers.

## Metrics (in-process)

`RaiderIoMetrics`:

- `requestsTotal`
- `cacheHits` / `cacheMisses`
- `rateLimited`
- `negativeCacheHits`
