# Blizzard APIs — Wave 3 live integration notes

**Research date:** 2026-07-27  
**Status:** verified against official path naming + community API references; live credentialed revalidation still pending in this environment.

## Authentication and hosts

Use Blizzard OAuth client credentials on the server. Cache access tokens until shortly before expiry (single-flight refresh). Never expose the client secret to the Vue application.

| Region | API host | Profile NS | Dynamic NS | Static NS | Default locale |
|---|---|---|---|---|---|
| EU | `https://eu.api.blizzard.com` | `profile-eu` | `dynamic-eu` | `static-eu` | `en_GB` |
| US | `https://us.api.blizzard.com` | `profile-us` | `dynamic-us` | `static-us` | `en_US` |
| KR | `https://kr.api.blizzard.com` | `profile-kr` | `dynamic-kr` | `static-kr` | `ko_KR` |
| TW | `https://tw.api.blizzard.com` | `profile-tw` | `dynamic-tw` | `static-tw` | `zh_TW` |

Token endpoint: `POST https://oauth.battle.net/token` (`grant_type=client_credentials`).

China (`CN`) is **not** supported in Wave 3.

Character profile calls are region-hosted and use a profile namespace, for example:

```text
GET https://{region}.api.blizzard.com/profile/wow/character/{realmSlug}/{characterName}
    ?namespace=profile-{region}&locale={locale}
```

Paths and names must be normalized/lowercased and URL encoded where required.

## Endpoints needed for this MVP

### Profile APIs (verified path names)

```text
/profile/wow/character/{realmSlug}/{characterName}
/profile/wow/character/{realmSlug}/{characterName}/equipment
/profile/wow/character/{realmSlug}/{characterName}/specializations
/profile/wow/character/{realmSlug}/{characterName}/character-media
/profile/wow/character/{realmSlug}/{characterName}/mythic-keystone-profile
/profile/wow/character/{realmSlug}/{characterName}/mythic-keystone-profile/season/{seasonId}
```

**Media path reconciliation:** the official Profile API uses `/character-media`. The previous `/media` implementation was incorrect and has been corrected with a contract test (`CHARACTER_MEDIA_PATH_SUFFIX`).

Use the profile index for current rating and the current-season endpoint for the best seasonal runs returned by Blizzard. Do **not** describe `best_runs` as a complete run history.

### Game Data APIs

Resolve current season/period dynamically rather than hardcoding IDs:

```text
/data/wow/mythic-keystone/season/index          # prefer current_season.id
/data/wow/mythic-keystone/season/{seasonId}
/data/wow/mythic-keystone/period/index          # prefer current_period.id
/data/wow/mythic-keystone/period/{periodId}
/data/wow/mythic-keystone/dungeon/index
/data/wow/mythic-keystone/dungeon/{dungeonId}
/data/wow/realm/{realmSlug}
```

A season contains weekly periods. Provider helpers:

- `resolveCurrentSeasonPeriod()` — season from `season/index.current_season`, period from `period/index.current_period`
- `getCurrentSeasonBestRuns(identity)` — season profile for the resolved season id

## Identity and error semantics

| Condition | HTTP | `ExternalApiError.code` | `details.reason` |
|---|---|---|---|
| Bad request / validation | 400 | `INVALID_RESPONSE` | `INVALID_REQUEST` |
| Confirmed missing resource (non-character) | 404 | `NOT_FOUND` | `NOT_FOUND` |
| Character profile 404 (missing **or** privacy / Share Game Data off) | 404 | `NOT_FOUND` | `PROFILE_UNAVAILABLE` |
| Forbidden / restricted | 403 | `UNAUTHORIZED` | `PRIVATE_OR_RESTRICTED` |
| Rate limited | 429 | `RATE_LIMITED` | `RATE_LIMITED` |
| Upstream 5xx | 5xx | `NETWORK` | `PROVIDER_UNAVAILABLE` |
| Timeout | — | `TIMEOUT` | `TIMEOUT` |
| Transient network | — | `NETWORK` | `TRANSIENT_NETWORK` |
| Malformed JSON / schema | — | `INVALID_RESPONSE` | `INVALID_PROVIDER_RESPONSE` |

Notes:

- There is no dependable public endpoint for fuzzy/global character-name search. The UI must collect exact `region + realm slug + name`.
- Character-profile 404 **must not** be worded as “character does not exist”; use `PROFILE_UNAVAILABLE`.
- Canonical realm/name come from Blizzard when present; submitted identity is retained on errors and via `buildIdentityDiagnostics` / `resolveCharacterIdentity`.
- Support `EU`, `US`, `KR`, and `TW` only.

## Reliability requirements (implemented)

- Token cache with single-flight refresh.
- Per-region base URL and namespace handling.
- Explicit request timeout (default 15s) → `TIMEOUT`.
- Retry transient `429` and `5xx` with capped exponential backoff + jitter.
- Honor `Retry-After` as delta-seconds **or** HTTP-date.
- Do not retry confirmed validation errors or stable `404`.
- Bounded negative cache for non-retryable 400/404.
- Record status, request fingerprint, fetched time, expiry and redacted error classification.
- Observation envelopes via `buildObservationEnvelope` never include Authorization / secrets.
- Fixture schemas aligned with live response shapes through package contract tests.

## Data authority

Use Blizzard as the canonical source for:

- character identity,
- class/race/faction (faction present on profile payload; race not yet on `CanonicalCharacter` contract),
- active specialization,
- equipment/item level,
- character media,
- current Mythic+ profile/rating,
- season and dungeon metadata.

Blizzard’s character season endpoint and leaderboard-derived data can lag or differ from Raider.IO. Persist source disagreement instead of silently choosing whichever response arrived last.

## Terms/privacy gate

Blizzard requires a registered application/API key and can revoke access. Its API terms include restrictions relevant to charging for API-powered features and require applicable privacy-law compliance. Before public launch or monetization, record a product-specific legal decision in the repository.

## Unresolved / follow-up

- Live credentialed schema revalidation was not run in this agent environment (no `BLIZZARD_CLIENT_*`).
- Period DTOs remain package-local (not yet on `BlizzardProvider` shared contract); Agent 15 may open a CR if DAG needs them on the interface.
- `CanonicalCharacter` still lacks race/faction fields (contract ownership).
- Scoring still must stop mapping raw Mythic rating to a fake percentile (`/3200`) — owned by Agent 15.

## Primary references

- Blizzard Developer Portal: https://develop.battle.net/documentation/world-of-warcraft
- Blizzard API Terms of Use: https://www.blizzard.com/fr-fr/legal/8c41e7e6-9f01-4f1a-8a2a-7d2fbd7f1d1b/blizzard-api-terms-of-use
- Blizzard API forum — profile endpoint examples: https://us.forums.blizzard.com/en/wow/c/api-discussion/18
- Community clients confirming `/character-media` path (e.g. FuzzyStatic/blizzard `wowp.go`)
