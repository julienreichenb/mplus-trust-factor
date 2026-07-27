# Agent 3 — Raider.IO Minimal Provider Plan

## Self-review (pre-implementation)

This plan was reviewed against bootstrap docs, shared contracts, and live OpenAPI v0.62.5 (`https://raider.io/swagger.json`, fetched 2026-07-27). Live cutoffs endpoint returned HTTP 500 during verification; fixtures will be used for tests and fixture mode.

**Verdict:** Proceed with implementation. Scope is limited to documented REST endpoints, minimal field sets, in-memory cache/rate-limit, and additive contract types.

---

## OpenAPI observations (v0.62.5)

### Allowed endpoints

| Endpoint | Method | Required params | Optional params | MVP use |
|----------|--------|-----------------|-----------------|---------|
| `/api/v1/characters/profile` | GET | `region`, `realm`, `name` | `fields`, `access_key` | Stale/new character refresh only |
| `/api/v1/mythic-plus/season-cutoffs` | GET | `region` | `season`, `access_key` | EU daily cache |
| `/api/v1/mythic-plus/static-data` | GET | `expansion_id` | `access_key` | Season/dungeon mapping, long cache |
| `/api/v1/mythic-plus/run-details` | GET | `season`, `id` | `access_key` | Selected run when roster missing from profile |
| `/api/v1/periods` | GET | — | `access_key` | Season/week context when static data insufficient |

### Excluded endpoints

- `/api/v1/mythic-plus/runs` — no bulk crawl
- `/api/v1/live-tracking/**` — no live tracking
- `/api/v1/mythic-plus/affixes`, `leaderboard-capacity`, `score-tiers` — not required for MVP

### Minimal character `fields` string

Single profile request per stale refresh:

```
mythic_plus_scores_by_season:current:previous,mythic_plus_ranks,mythic_plus_recent_runs,mythic_plus_best_runs,mythic_plus_highest_level_runs,raid_progression:current-expansion
```

**Rationale:** Scores (current + previous season), ranks, run candidates with roster, raid progression. No `gear` (Blizzard primary). No `talents`, `guild`, `covenant`, weekly runs, alternate runs.

### Response fields consumed

From `ViewCharacterProfileResponse`:

- Identity: `name`, `region`, `realm`, `class`, `active_spec_name`, `active_spec_role`, `profile_url`, `last_crawled_at`
- `mythic_plus_scores_by_season[]` → season slug, scores (`all`, role splits), segments
- `mythic_plus_ranks` → overall/role/class/world/region ranks
- `mythic_plus_recent_runs`, `mythic_plus_best_runs`, `mythic_plus_highest_level_runs` → `KeystoneRun` arrays with `keystone_run_id`, dungeon, level, timing, score, roster when present
- `raid_progression` → summary tiers

From `ViewSeasonCutoffsResponse`:

- `cutoffs.p750` — 75th percentile (top 25% threshold)
- `cutoffs.updatedAt`, `cutoffs.region`

From `ViewMythicPlusStaticDataResponse`:

- Seasons, dungeons, slug mappings

From `ViewMythicPlusRunDetailsResponse`:

- Full roster when profile runs lack teammates

### Fields explicitly excluded

- Gear, talents, guild, covenant, achievement meta/curve
- Alternate runs, weekly highest runs
- Live-tracking payloads
- Bulk `/runs` listings
- UI-only cutoff graph data (not needed for threshold)

---

## Minimal call matrix

| Trigger | Calls | Notes |
|---------|-------|-------|
| Fresh character search (stale) | 1× profile | Minimal `fields` only |
| Eligibility check (top 25%) | 0–1× cutoffs | Cached 24h per region/season |
| Dungeon/season mapping | 0–1× static-data | Cached 24h–7d |
| Latest/highest run missing roster | 0–1× run-details | Only when profile run lacks roster |
| Season/week context | 0–1× periods | Only if static data lacks current period |

**Target:** One stale character refresh = **1 API call** in the common case (profile only).

---

## Terms and attribution summary

Per OpenAPI info block (v0.62.5):

- **Rate limit:** 200 req/min unauthenticated; register app for higher limits
- **Attribution:** Public apps must link to [raider.io](https://raider.io)
- **Acceptable use:** Community/personal use; no competing services, resale, or harm to platform; no scraping beyond published endpoints
- **Commercial:** Contact Raider.IO before monetization or broad public launch

Normalized output includes `RaiderIoAttribution` with display text, homepage URL, and profile URL when character data is used.

---

## Replaceability plan

1. All Raider.IO code behind `RaiderIoProvider` in `@mplus/provider-raiderio`
2. Normalized DTOs in `@mplus/contracts/raiderio` — provider-agnostic names
3. `RAIDERIO_ENABLED=false` disables provider; workers skip Raider.IO step
4. Blizzard remains primary for identity/equipment; WCL for detailed logs
5. Cutoffs replaceable by internal distribution later
6. Field dependency matrix documented in `doc/api/raiderio/replaceability.md`

---

## Rate limiter and TTL policy

| Setting | Default | Env var |
|---------|---------|---------|
| Soft RPM | 60 | `RAIDERIO_SOFT_RPM` |
| Concurrency | 2 | `RAIDERIO_REQUEST_CONCURRENCY` |
| Character TTL | 12h | `RAIDERIO_CHARACTER_TTL_SECONDS` |
| Negative cache | 45m | `RAIDERIO_NEGATIVE_CACHE_SECONDS` |
| Cutoffs TTL | 24h | `RAIDERIO_CUTOFFS_TTL_SECONDS` |
| Static data TTL | 7d | `RAIDERIO_STATIC_DATA_TTL_SECONDS` |

- Token bucket soft limit, honor 429 + `Retry-After`, exponential backoff with jitter
- Request fingerprint + in-flight dedupe via `buildRequestFingerprint`
- Metrics: `requestsTotal`, `cacheHits`, `cacheMisses`, `rateLimited`

---

## Data for boost features (Agent 4)

Neutral facts via `RaiderIoBoostSupportFacts`:

- Run timestamp, dungeon, key level, duration, timed
- Target score/rank at snapshot
- Teammate identities and scores/ranks when in payload
- Roster recurrence hints (same teammate keys across runs)
- Current/previous season score history
- Run volume and `historyIncomplete: true` flag
- **Does not** compute "boosted"

---

## Contract changes (additive)

New file `packages/contracts/src/raiderio.ts` with normalized DTOs.

Extend `RaiderIoProvider`:

- `readonly enabled: boolean`
- Typed returns replacing `unknown`
- Add `getStaticData`, `getRunDetails` (optional `getPeriods`)

Change request: `doc/contracts/change-requests/03-raiderio-types.md`

Config additions:

- `RAIDERIO_ENABLED` (default `true`)
- `RAIDERIO_NEGATIVE_CACHE_SECONDS`
- `RAIDERIO_CUTOFFS_TTL_SECONDS`
- `RAIDERIO_STATIC_DATA_TTL_SECONDS`

---

## Implementation structure

```
packages/providers/raiderio/src/
  constants.ts       # endpoints, TTL defaults
  fields.ts          # minimal field builder
  raw-types.ts       # internal raw shapes
  normalize.ts       # raw → contract DTOs
  cache.ts           # memory cache + negative + dedupe
  rate-limiter.ts    # token bucket
  http-client.ts     # fetch, retry, 429
  metrics.ts         # counters
  fixture-provider.ts
  live-provider.ts
  disabled-provider.ts
  index.ts           # createRaiderIoProvider factory

tools/fixtures/raiderio/
  character-profile-eu.json
  season-cutoffs-eu.json
  static-data.json
  run-details.json
  character-not-found.json
  rate-limited-429.json
  malformed-response.json

doc/api/raiderio/
  overview.md
  openapi-observations.md
  minimal-call-matrix.md
  cache-and-rate-policy.md
  terms-and-commercial-risk.md
  replaceability.md
```

---

## Tests

- Field list and URL/query encoding
- Rate limiter token bucket
- Cache hit, negative cache, in-flight dedupe
- 429 backoff with Retry-After
- Normalization (scores, runs, roster, cutoffs p750)
- Fixture provider end-to-end
- Disabled provider (`enabled: false`)
- Attribution presence on all normalized outputs

---

## Acceptance mapping

| Criterion | How verified |
|-----------|--------------|
| No scraping | REST client only |
| No bulk `/runs` | Endpoint not implemented |
| 1 call per stale refresh | Call matrix + test |
| Disable by config | `RAIDERIO_ENABLED=false` |
| Cutoffs top-25% | `p750` normalized |
| Rate limiter under soft RPM | Unit test |
| Attribution | Normalized DTO + test |
| lint/typecheck/test/build | CI commands |

---

## Assumptions

- OpenAPI v0.62.5 field syntax is authoritative
- `mythic_plus_scores_by_season:current:previous` returns both seasons in request order
- `p750.score` is the regional top-25% threshold (75th percentile cutoff)
- Live API may be unavailable in CI; fixture mode is default
- `expansion_id=10` for The War Within static data (verify against static-data response)

## Out of scope

- Worker orchestration wiring (Agent 5)
- Scoring/authenticity computation (Agent 4)
- Frontend attribution UI (Agent 6)
- App registration / production scale
