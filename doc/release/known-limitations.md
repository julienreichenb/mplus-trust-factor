# Known limitations — Wave 3

## Providers

| Area | Limitation |
|------|------------|
| Blizzard live | Requires OAuth credentials; media/equipment/talents soft-skip independently |
| WCL live | Requires OAuth + `WCL_MPLUS_ZONE_ID`; set `WCL_MPLUS_ZONE_EXPIRES_AT` to alarm stale zones |
| WCL rankings | Expired zone skips `zoneRankings` (bounded recent reports only) |
| Raider.IO live | Season-cutoffs may soft-fail (HTTP 500 observed historically); non-blocking |
| Raider.IO legal | Commercial/competing use requires Raider.IO contact before launch |
| Raider.IO cache | In-memory only; Postgres/Redis persistence deferred |

## Product

| Area | Limitation |
|------|------------|
| Scoring | Model **default v2** active; v1 archived. Further calibration is follow-up |
| PERFORMANCE | Current-season WCL Best % / Median %; utility mechanic catalog incomplete |
| Frontend | Approved UI integrated; visual polish / Wowhead optional and off by default |
| Compare | Minimum 2 candidates enforced on submit |
| Hidden logs | Reduce confidence via visibility; do not force zero score |
| Boost detection | Probabilistic wording only; no dispute mechanism |

## Engineering

| Area | Limitation |
|------|------------|
| Observability | Structured refresh events + `/metrics`; no Prometheus alert rules/dashboards yet |
| E2E | Playwright mock + fixture pipelines; Postgres `:5433` required for fixture E2E |
| Addon | Export tooling exists; not part of Wave 3 merge gate |
| OpenAPI | Generated `openapi.json` is gitignored; regenerate with `pnpm openapi:generate` |
