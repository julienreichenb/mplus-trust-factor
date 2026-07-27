# Blizzard APIs — Wave 3 live integration notes

**Research date:** 2026-07-27  
**Status:** implementation guidance, not legal advice.

## Authentication and hosts

Use Blizzard OAuth client credentials on the server. Cache access tokens until shortly before expiry. Never expose the client secret to the Vue application.

Character profile calls are region-hosted and use a profile namespace, for example:

```text
GET https://{region}.api.blizzard.com/profile/wow/character/{realmSlug}/{characterName}
    ?namespace=profile-{region}&locale={locale}
```

Paths and names must be normalized/lowercased and URL encoded where required.

## Endpoints needed for this MVP

### Profile APIs

```text
/profile/wow/character/{realmSlug}/{characterName}
/profile/wow/character/{realmSlug}/{characterName}/equipment
/profile/wow/character/{realmSlug}/{characterName}/specializations
/profile/wow/character/{realmSlug}/{characterName}/character-media
/profile/wow/character/{realmSlug}/{characterName}/mythic-keystone-profile
/profile/wow/character/{realmSlug}/{characterName}/mythic-keystone-profile/season/{seasonId}
```

Use the profile index for current rating and the current-season endpoint for the best seasonal runs returned by Blizzard. Do not describe it as a complete run history.

### Game Data APIs

Resolve current season/period dynamically rather than hardcoding IDs:

```text
/data/wow/mythic-keystone/season/index
/data/wow/mythic-keystone/season/{seasonId}
/data/wow/mythic-keystone/period/index
/data/wow/mythic-keystone/period/{periodId}
/data/wow/mythic-keystone/dungeon/index
/data/wow/mythic-keystone/dungeon/{dungeonId}
/data/wow/realm/{realmSlug}
```

A season contains weekly periods. Determine the current season and period from timestamps and region, then persist their IDs and validity window.

## Identity and error semantics

- There is no dependable public endpoint for fuzzy/global character-name search. The UI must collect exact `region + realm slug + name`.
- A character-profile 404 can mean a bad identity, unavailable profile data, or disabled Battle.net “Share Game Data”. The UI must avoid overclaiming.
- Support `EU`, `US`, `KR`, and `TW` in Wave 3. Treat China support as unsupported until officially verified.
- Normalize canonical realm and character values returned by Blizzard and retain the submitted identity for diagnostics.

## Data authority

Use Blizzard as the canonical source for:

- character identity,
- class/race/faction,
- active specialization,
- equipment/item level,
- character media,
- current Mythic+ profile/rating,
- season and dungeon metadata.

Blizzard’s character season endpoint and leaderboard-derived data can lag or differ from Raider.IO. Persist source disagreement instead of silently choosing whichever response arrived last.

## Reliability requirements

- Token cache with single-flight refresh.
- Per-region base URL and namespace handling.
- Explicit request timeout.
- Retry transient `429` and `5xx` responses with capped exponential backoff and jitter.
- Honor `Retry-After` when present.
- Do not retry confirmed validation errors or stable `404` indefinitely.
- Record status, request fingerprint, fetched time, expiry and redacted error classification.
- Keep fixture schemas aligned with live responses through contract tests.

## Terms/privacy gate

Blizzard requires a registered application/API key and can revoke access. Its API terms include restrictions relevant to charging for API-powered features and require applicable privacy-law compliance. Before public launch or monetization, record a product-specific legal decision in the repository.

## Current repository risks to address

- Verify that `character-media` path naming matches the current API; the existing implementation currently uses `/media` and may need reconciliation.
- The current pipeline fetches a Mythic profile index but does not consume current-season best runs.
- The current score maps raw Mythic rating to a field named `performance.spec_percentile` using a fixed `/3200` divisor. Replace this with a season-aware, correctly named observation.
- Add a live smoke test that exercises profile, equipment, specializations, media, current season and current-season profile for one allowlisted identity.

## Primary references

- Blizzard Developer Portal: https://develop.battle.net/documentation/world-of-warcraft
- Blizzard API Terms of Use: https://www.blizzard.com/fr-fr/legal/8c41e7e6-9f01-4f1a-8a2a-7d2fbd7f1d1b/blizzard-api-terms-of-use
- Blizzard API forum — profile endpoint examples: https://us.forums.blizzard.com/en/wow/c/api-discussion/18
- Blizzard API patch notes: https://us.forums.blizzard.com/en/wow/t/api-patch-notes/218611
