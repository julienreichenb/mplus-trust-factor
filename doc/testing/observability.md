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
| `scoring_v2_manifest_coverage_total` | coverageState |
| `scoring_v2_slots_per_character` | expected |
| `scoring_v2_fallback_depth` | — |
| `scoring_v2_dataset_outcome_total` | outcome, datasetKey?, dimension? |
| `scoring_v2_wcl_points_total` | datasetKey?, dimension? |
| `scoring_v2_slot_outcome_total` | outcome, status? |
| `scoring_v2_batch_outcome_total` | outcome |
| `scoring_v2_admission_total` | action |
| `scoring_v2_publication_total` | action, reason? |
| `scoring_v2_score_distribution` / `scoring_v2_confidence_distribution` | source, modelKey? |
| `scoring_v2_v1_v2_delta_abs` | — |
| `scoring_v2_queue_age_ms` | queue |
| `scoring_v2_artifact_bytes` | kind |
| `scoring_v2_artifact_orphans_total` | — |
| `scoring_v2_calibration_*` / `scoring_v2_reference_slice_state_total` | — |
| `scoring_v2_finalization_recovery_total` | action (`claim_released` \| `claim_lost` \| `reclaim`) |

Cost-source classification (frozen / provider-estimated / unknown) is **deferred** — do not extend `scoring_v2_wcl_points_total` labels until a dedicated series is designed.

### Scoring V2 events

Normative names (also on `OBS_EVENTS`): `scoring_v2.discovery_*`, `manifest_frozen`, `admission_*`, `slot_*`, `dataset_*`, `fact_set_written`, `batch_*`, `publication_*`, `calibration_*`, `reference_slice_state_changed`, plus operational `finalization_claim_released` / `finalization_claim_lost` / `finalization_reclaim`.

Emit via `emitScoringV2Event` (exception-safe) so character ids/names and report codes are fingerprinted/redacted. Free-text reasons go through `normalizeOperationalError` / `sanitizeFreeText`.

### WCL budget helper

`computeWclBudgetSnapshot({ pointsSpent, hourlyLimit, warnPercent, deferPercent, stopPercent })` returns `shouldWarn`, `shouldDefer`, `shouldStop` for worker integration.

### Readiness

`GET /health/ready` reports `revision`, contract versions, V2 feature modes, WCL snapshot ownership, artifact backend, queue mode, and model/catalog compatibility. Failures are mode-conditional (`evaluateReadiness` / `requiredProbesForModes`).

- Artifact probe is **read-only** (no `mkdir`) and skipped when unused.
- WCL usability is required whenever evidence fetch is enabled; fixture mode may satisfy; `WCL_ENABLED=false` does **not** make a required dependency optional in live mode.
- Never calls live providers.

### Runbooks

See [doc/operations/scoring-v2-runbooks.md](../operations/scoring-v2-runbooks.md).

## Dashboards

No heavy stack in MVP. Scrape `/metrics` with Prometheus or inspect logs via Loki/CloudWatch when deployed.
