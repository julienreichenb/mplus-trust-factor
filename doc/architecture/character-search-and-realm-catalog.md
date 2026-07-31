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

- Source of truth: Blizzard `GET /data/wow/realm/index` (`dynamic-{region}`) for EU, US, KR, TW
- Local API: `GET /api/v1/realms` — database only; never Blizzard per keystroke
- Sync is **index-first**: every index entry is upserted immediately; detail enrichment is optional, best-effort, bounded-concurrency (`REALM_CATALOG_DETAIL_CONCURRENCY`)
- Soft-omit: a single provider omission does not hard-delete realms (last-known-good)
- Worker bootstrap (`ensureRealmCatalogReady`) checks catalog freshness (`REALM_CATALOG_STALE_SECONDS`, default 7 days):
  - empty → index-first sync before ready; fail closed in **live** mode if still empty
  - stale but non-empty → attempt refresh; remain ready on temporary Blizzard failure
- Manual `pnpm realms:sync` remains available for maintenance (`--force-details` for enrichment)
- Not coupled to score-model seeding

## UI copy

Public helper (English): suggestions are indexed M+ Trust Factor profiles; exact Region + Realm + Name can still be searched on Blizzard.
