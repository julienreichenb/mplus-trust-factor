# Raider.IO API — Wave 3 live integration notes

**Research date:** 2026-07-27  
**Status:** implementation guidance, not legal advice.

## API and rate limits

The official API is documented by Raider.IO’s OpenAPI document. The unauthenticated public allowance is documented as 200 requests/minute, subject to change. Handle `429` with backoff. An application key may provide higher limits.

Do not scrape Raider.IO pages. Use only documented API endpoints.

## Required attribution and terms

Raider.IO requires a prominent backlink when displaying Raider.IO-derived data. Keep `profile_url` and render a visible Raider.IO attribution near score/rank/run data.

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

Recommended bounded field set:

```text
gear,
talents,
mythic_plus_scores_by_season:current,
mythic_plus_ranks,
mythic_plus_recent_runs,
mythic_plus_best_runs
```

Only request additional fields when the product uses them. `mythic_plus_recent_runs` and `mythic_plus_best_runs` are bounded lists, suitable for this MVP.

Useful profile fields include:

- canonical name/region/realm,
- class/spec/role/faction,
- thumbnail and profile URL,
- `last_crawled_at`,
- gear,
- current-season scores,
- ranks,
- recent/best runs.

Run objects can include dungeon, key level, completion time, clear/par time, upgrades, score, URL, affixes and played spec/role.

## Optional endpoints

```text
GET /api/v1/periods
GET /api/v1/mythic-plus/static-data
GET /api/v1/mythic-plus/run-details
GET /api/v1/mythic-plus/season-cutoffs
```

For Wave 3:

- Use `periods` or static data only when needed to map the current season/period.
- Do not make `season-cutoffs` a hard dependency; it returned HTTP 500 during Wave 2 verification.
- Do not hardcode expansion ID. Resolve supported/current expansion dynamically from API data or a versioned configuration with an explicit expiry warning.
- `run-details` must preserve the actual region; the current implementation hardcodes `EU` in its return value and must be fixed.

## Data use decisions

- Raider.IO score is a source observation, not the M+ Trust Factor score.
- Use ranks/scores and recent/best runs as supporting performance/experience evidence.
- Record `last_crawled_at`; stale Raider.IO data must be labelled.
- Reconcile identity against Blizzard. On mismatch, warn and exclude questionable fields from scoring.
- Do not use alternate-character linkage or sensitive inference in the MVP unless it is clearly documented, necessary and legally approved.
- Raider.IO can lag Blizzard because its crawler updates asynchronously; disagreement is expected and must be surfaced.

## Reliability requirements

- Configurable timeout, retry and concurrency.
- Respect `429` and `Retry-After`.
- Provider-local cache must become Redis/Postgres-backed or use the project’s shared external request cache; in-memory-only cache is insufficient for multiple workers/restarts.
- Cache by normalized identity plus exact field set.
- Persist provider timestamp, source URL, request fingerprint and schema version.
- Validate responses with Zod and retain redacted parse diagnostics.

## Current repository risks to address

- `fetchRunDetails()` returns `region: "EU"` regardless of input.
- Static expansion ID is hardcoded.
- `season-cutoffs` is currently treated as implemented despite observed server errors.
- Confirm that `RAIDERIO_APP_KEY` is sent using the exact mechanism documented for approved applications; do not guess query/header behavior.
- Ensure the frontend shows the required backlink for every Raider.IO-derived score/rank/run section.

## Primary references

- Official OpenAPI document: https://raider.io/swagger.json
- Raider.IO API overview: https://raider.io/api
- Raider.IO support — API and data freshness: https://support.raider.io/
