# Raider.IO API — Wave 3 live integration notes

**Research date:** 2026-07-27  
**Status:** implementation guidance, not legal advice.  
**OpenAPI version verified:** v0.62.5 (`https://raider.io/swagger.json`)

## API and rate limits

The official API is documented by Raider.IO’s OpenAPI document. The unauthenticated public allowance is documented as 200 requests/minute, subject to change. Handle `429` with backoff and honor `Retry-After`. An application key may provide higher limits.

Do not scrape Raider.IO pages. Use only documented API endpoints.

## Application key transmission (verified)

OpenAPI documents optional `access_key` as a **query parameter** on every used endpoint:

> The API key from your RaiderIO App: http://raider.io/settings/apps.

`RAIDERIO_APP_KEY` is sent only as `access_key=...` in the query string. Do not invent Authorization headers or alternate schemes.

## Required attribution and terms

Raider.IO requires a prominent backlink when displaying Raider.IO-derived data. Keep `profile_url` / `attribution.profileUrl` and render a visible Raider.IO attribution near score/rank/run data.

The public API terms describe community/personal use and restrict competing services, resale and some commercial uses. Public launch or monetization must remain gated on written confirmation or a commercial agreement appropriate to M+ Trust Factor.

## Endpoint needed for the character MVP

```text
GET /api/v1/characters/profile
```

Required query parameters:

```text
region={region lowercase}
realm={realm slug}
name={character name}
fields={comma-separated fields}
```

Wave 3 minimum explicit field set:

```text
gear,
talents,
mythic_plus_scores_by_season:current,
mythic_plus_ranks,
mythic_plus_recent_runs,
mythic_plus_best_runs
```

### Live response notes (2026-07-27)

- Missing characters return **HTTP 400** with message `Could not find requested character` (not 404).
- `mythic_plus_ranks` uses nested buckets: `{ overall: { world, region, realm }, class: {...}, dps: {...} }`.
- `gear.items` is an object keyed by slot (not an array) on live payloads; empty gear may return `items: []`.
- `talents` may be omitted even when requested.
- `last_crawled_at` can be years old; treat as stale when older than the provider threshold (7 days).

## Optional endpoints

```text
GET /api/v1/periods
GET /api/v1/mythic-plus/static-data?expansion_id={id}
GET /api/v1/mythic-plus/run-details?season={slug}&id={runId}
GET /api/v1/mythic-plus/season-cutoffs?region={region}
```

### Expansion IDs (OpenAPI)

| ID | Label |
|----|-------|
| 11 | Midnight (documented current as of 2026-07-27) |
| 10 | The War Within |
| 9 | Dragonflight |
| 8 | Shadowlands |
| 7 | Battle for Azeroth |
| 6 | Legion |

Do not hardcode an unversioned expansion. Resolve via documented catalog + static-data probe, or an explicit override with pin-age warning (`RAIDERIO_EXPANSION_DOCUMENTED_AS_OF`).

### Periods shape

Live `/periods` returns per-region windows (`previous` / `current` / `next` with `period`, `start`, `end`), not the legacy flat `{ id, season, starts_at, ends_at }` list. The provider normalizes both shapes.

### Season cutoffs

`GET /api/v1/mythic-plus/season-cutoffs?region=eu` returned **HTTP 500** during Wave 2 and Wave 3 verification. Treat cutoffs as **optional / non-blocking**. Capability state `seasonCutoffs=unavailable` is set when the endpoint fails; character refresh must continue.

### Run details region

`run-details` does not accept a region query param. Region must come from `ProviderFetchContext.region` and/or roster `character.region.slug`. Never hardcode `EU`.

## Reliability requirements

- Configurable timeout (default 10s), retry and concurrency.
- Respect `429` and `Retry-After`.
- Retry transient 5xx / network / timeout with backoff + jitter.
- Reject malformed JSON as `INVALID_RESPONSE`.
- Zod-validate core response envelopes; keep redacted parse diagnostics in error details.
- Provider exposes `RaiderIoCacheStore` + `describeCacheEntry()` so Agent 15 can back the cache with `ExternalRequest` persistence without duplicating HTTP calls. Default remains in-memory until that wiring lands.

## Manual smoke (no app key required)

```powershell
$env:ALLOW_LIVE_PROVIDER_CALLS="true"
# optional overrides:
# $env:RAIDERIO_SMOKE_REGION="EU"
# $env:RAIDERIO_SMOKE_REALM="silvermoon"
# $env:RAIDERIO_SMOKE_NAME="Pin"
node --import tsx packages/providers/raiderio/src/smoke-live.ts
```

Within documented public limits, smoke works without `RAIDERIO_APP_KEY`.

## Legal / commercial launch gate

Public launch or monetization remains blocked until Raider.IO terms are reviewed for the intended commercial product posture. See `doc/api/raiderio/terms-and-commercial-risk.md`.

## Primary references

- Official OpenAPI document: https://raider.io/swagger.json
- Raider.IO API overview: https://raider.io/api
- Raider.IO support — API and data freshness: https://support.raider.io/
