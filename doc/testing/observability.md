# Observability

## Logging

- **Library**: Pino via `@mplus/observability`
- **Redaction**: `SECRET_REDACT_PATHS` — authorization, cookies, client secrets, API keys
- **Correlation**: `x-request-id` header; Fastify `request.id`

### Useful log queries (JSON)

```text
# 5xx by route
level >= 50 && route == "/api/v1/characters/:id"

# Provider errors (when wired by worker)
provider && statusCode >= 400

# Rate limit events
msg =~ /rate limit/i || code == "RATE_LIMITED"
```

## Metrics

- **Endpoint**: `GET /metrics` (Prometheus text exposition)
- **Registry**: `getMetricsRegistry()` in `@mplus/observability`

### Instrumented signals

| Metric | Labels |
|--------|--------|
| `http_requests_total` | route, method, status |
| `http_request_duration_ms` | route, method, status |
| `http_errors_total` | route, method, status |
| `provider_requests_total` | provider, endpointKey, status, cacheHit |
| `provider_rate_limited_total` | provider |
| `provider_cache_hits_total` | provider |
| `queue_failures_total` | queue |
| `score_calculations_total` | modelKey, modelVersion |
| `addon_exports_total` | — |

### WCL budget helper

`computeWclBudgetSnapshot({ pointsSpent, hourlyLimit, warnPercent, deferPercent, stopPercent })` returns `shouldWarn`, `shouldDefer`, `shouldStop` for worker integration.

## Dashboards

No heavy stack in MVP. Scrape `/metrics` with Prometheus or inspect logs via Loki/CloudWatch when deployed.
