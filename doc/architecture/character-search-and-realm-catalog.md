# Character search and realm catalog

Canonical behaviour for public Research / character identity lookup.

## Locked Blizzard boundary

Blizzard **does not** expose a global or fuzzy player-character search API.

Supported external identity lookup is exact only:

`GET /profile/wow/character/{realmSlug}/{characterName}`

Therefore:

- Persisted-character autocomplete is **local** (PostgreSQL) and may be typo-tolerant.
- External characters are resolved only after the user submits exact **Region + Realm + Character Name**.
- Autocomplete never calls Blizzard, scrapes Armory, or fabricates remote suggestions.

## Persisted autocomplete (Scenario A)

- Endpoint: `GET /api/v1/characters/autocomplete?region=&query=`
- Min query length: **2**
- Cap: **8** public suggestions
- Matching: case- and accent-insensitive exact / prefix / substring; conservative `pg_trgm` fuzzy when the folded query length is ≥ 4
- Ranking (lower wins): exact → exact alias → prefix → substring → trigram-only fuzzy
- Public DTO omits internal character IDs, ownership, BattleTag, email, Mythic+ rating, Trust Score

Migration: `20260731180000_character_name_search_trgm` enables `pg_trgm` and a GIN index on `characters.name_search_key`. Extension creation fails the migration clearly if the DB role lacks permission.

After `name_search_key` was first added, run `pnpm db:backfill:character-name-search-key` once so accent folding matches write-path keys.

## Exact external resolve (Scenario B)

- Endpoint: `POST /api/v1/characters/resolve`
- Uses synchronized realm catalog + exact Blizzard profile lookup
- Empty local autocomplete **must not** block submit
- Shared refresh eligibility decides whether `refresh-character` is enqueued
- Blizzard 404 → `NOT_FOUND` (negative cache); retryable provider errors remain retryable

## Realm catalog

- Discovery: Blizzard `GET /data/wow/realm/index` (`dynamic-{region}`) for EU, US, KR, TW
- Public visibility: classified Realm detail only — see [`../research/providers/blizzard-realm-visibility.md`](../research/providers/blizzard-realm-visibility.md)
- Local API: `GET /api/v1/realms` — database only; never Blizzard per keystroke; returns **active** non-tournament rows
- Sync discovers via the index, early-rejects unmistakable technical names/slugs, fetches details with bounded concurrency (`REALM_CATALOG_DETAIL_CONCURRENCY`), and activates **only eligible** player-facing realms
- Technical/tournament rows are stored inactive (not hard-deleted); index-only rows are never publicly activated
- Soft-omit / last-known-good: transient detail failures retain previously validated active realms; empty/partial index does not wipe a region
- Worker bootstrap (`ensureRealmCatalogReady`) checks catalog freshness (`REALM_CATALOG_STALE_SECONDS`, default 7 days):
  - empty → sync with detail classification before ready; fail closed in **live** mode if still empty
  - stale but non-empty → attempt refresh; remain ready on temporary Blizzard failure
- Manual `pnpm realms:sync` remains available for maintenance (`--force-details` forces cache refresh on provider fetches)
- Not coupled to score-model seeding

## UI copy

Public helper (English): suggestions are indexed M+ Trust Factor profiles; exact Region + Realm + Name can still be searched on Blizzard.
