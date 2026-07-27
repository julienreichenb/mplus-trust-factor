# Raider.IO cache and rate policy

## Internal soft budget

| Setting | Default | Env var |
|---------|---------|---------|
| Soft RPM | 60 | `RAIDERIO_SOFT_RPM` |
| Concurrency | 2 | `RAIDERIO_REQUEST_CONCURRENCY` |
| Character TTL | 12 hours | `RAIDERIO_CHARACTER_TTL_SECONDS` |
| Negative cache | 45 minutes | `RAIDERIO_NEGATIVE_CACHE_SECONDS` |
| Cutoffs TTL | 24 hours | `RAIDERIO_CUTOFFS_TTL_SECONDS` |
| Static data TTL | 7 days | `RAIDERIO_STATIC_DATA_TTL_SECONDS` |

Official unauthenticated limit: **200 req/min** (we stay well below at 60).

## Rate limiting implementation

- Token bucket (`createRpmLimiter`) per HTTP client
- Concurrency semaphore (max 2 in-flight)
- On HTTP 429: honor `Retry-After`, exponential backoff with jitter, max 3 retries

## Caching implementation

- In-memory cache keyed by `buildRequestFingerprint`
- In-flight dedupe for identical concurrent requests
- Negative cache for 404 characters (45 min default)
- `forceRefresh` on `ProviderFetchContext` bypasses positive cache

## Metrics (in-process)

`RaiderIoMetrics`:

- `requestsTotal`
- `cacheHits` / `cacheMisses`
- `rateLimited`
- `negativeCacheHits`

## Refresh policy alignment

- No profile refresh on every page load (Agent 5 worker enforces cooldown)
- Manual refresh subject to global `MANUAL_REFRESH_COOLDOWN_SECONDS`
