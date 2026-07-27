# Agent 01 — Blizzard / Battle.net Provider Plan

**Date:** 2026-07-27  
**Branch:** `agent/blizzard`  
**Ownership:** `packages/providers/blizzard/**`, `doc/api/blizzard/**`, `tools/fixtures/blizzard/**`  
**Mode:** Fixture-first; live optional when credentials exist. No bulk API calls.

## Self-review

Plan covers all 11 required operations, OAuth lifecycle, TTLs, error mapping onto shared `ExternalApiError`, normalization into shared DTOs, fixtures, and tests. Contract surface on `BlizzardProvider` is too narrow for Agent 1 scope — will file a **backward-compatible** change request and extend the interface (no breaking removals). Official portal pages are JS-gated; endpoints/namespaces confirmed from bootstrap budget doc + Blizzard developer forum/namespace guidance (profile-* / dynamic-* / static-*). Proceeding to implementation without waiting for approval (no destructive actions, no major breaking contract changes).

## Official sources consulted

| Topic | URL |
|-------|-----|
| Developer portal | https://develop.battle.net/ |
| OAuth | https://community.developer.battle.net/documentation/guides/using-oauth |
| Regionality | https://community.developer.battle.net/documentation/guides/regionality-and-apis |
| Profile APIs | https://community.developer.battle.net/documentation/world-of-warcraft/profile-apis |
| Game Data APIs | https://community.developer.battle.net/documentation/world-of-warcraft/game-data-apis |
| Namespaces (forum confirmation) | https://us.forums.blizzard.com/en/blizzard/t/foridden-error-with-namespace-dynamic/49115 |
| Bootstrap budgets | `doc/bootstrap/API-SOURCES-AND-REQUEST-BUDGETS.txt` |

**Schema observation date:** 2026-07-27 (from docs + community confirmation; fixtures mirror documented shapes).

## Live endpoints and namespaces (EU default)

**Hosts**

| Region | API host | OAuth token |
|--------|----------|-------------|
| EU (default) | `https://eu.api.blizzard.com` | `https://oauth.battle.net/token` |
| US | `https://us.api.blizzard.com` | same |
| KR | `https://kr.api.blizzard.com` | same |
| TW | `https://tw.api.blizzard.com` | same |

**Namespaces / locale**

| Kind | Namespace pattern | Locale default |
|------|-------------------|----------------|
| Profile | `profile-{region}` e.g. `profile-eu` | `en_GB` |
| Dynamic game data | `dynamic-{region}` e.g. `dynamic-eu` | `en_GB` |
| Static game data | `static-{region}` e.g. `static-eu` | `en_GB` |

Query params on every API call: `namespace`, `locale`. Auth: `Authorization: Bearer <access_token>`.

### Profile (namespace `profile-{region}`)

| # | Operation | Method + path |
|---|-----------|---------------|
| 2 | Character summary | `GET /profile/wow/character/{realmSlug}/{characterName}` |
| 3 | Equipment | `.../equipment` |
| 4 | Specializations | `.../specializations` |
| 5 | Media / avatar | `.../media` |
| 6 | M+ profile index | `.../mythic-keystone-profile` |
| 7 | M+ season profile | `.../mythic-keystone-profile/season/{seasonId}` |

Character name path segment: lowercase, URL-encoded (supports accents/apostrophes). Realm: Blizzard slug.

### Game data

| # | Operation | Path | Namespace |
|---|-----------|------|-----------|
| 1 | Realm index | `GET /data/wow/realm/index` | dynamic |
| 1 | Realm | `GET /data/wow/realm/{realmSlug}` | dynamic |
| 8 | M+ season index | `GET /data/wow/mythic-keystone/season/index` | dynamic |
| 8 | M+ season | `GET /data/wow/mythic-keystone/season/{seasonId}` | dynamic |
| 9 | M+ dungeon index | `GET /data/wow/mythic-keystone/dungeon/index` | dynamic |
| 9 | M+ dungeon | `GET /data/wow/mythic-keystone/dungeon/{dungeonId}` | dynamic |
| 10 | Item | `GET /data/wow/item/{itemId}` | static |
| 10 | Item media | `GET /data/wow/media/item/{itemId}` | static |
| — | Playable specialization | `GET /data/wow/playable-specialization/{specId}` | static |
| 11 | Connected-realm leaderboard (explicit, no crawl) | `GET /data/wow/connected-realm/{connectedRealmId}/mythic-leaderboard/{dungeonId}/period/{periodId}` | dynamic |

## Authentication / token lifecycle

1. `POST https://oauth.battle.net/token` with `grant_type=client_credentials`.
2. HTTP Basic: `base64(client_id:client_secret)`.
3. Cache `access_token` until `expires_in - safetyWindow` (default safety 60s).
4. Concurrent refresh: single in-flight Promise; waiters share result.
5. Never log `client_secret` or `access_token` (rely on observability redaction paths + local scrubbing).
6. Fixture mode: no token calls; credentials optional.

## Request / response schemas needed (Zod at boundary)

Validated inbound Blizzard JSON (subset fields):

- Character profile: `id`, `name`, `realm.slug`, `character_class`, `active_spec`, `level`, `last_login_timestamp`, `_links`
- Equipment: `equipped_items[]` (slot, item.id, level, quality, name), `average_item_level`, `equipped_item_level`
- Specializations: `specializations[]`, `active_specialization`, talent loadouts when present
- Media: `assets[]` (`key`, `value` URL)
- Mythic keystone profile index: `current_period`, `seasons[]`, `character`, `current_mythic_rating`
- Mythic keystone season: `season`, `best_runs[]` (dungeon, keystone_level, duration, completed_timestamp, is_completed_within_time, mythic_rating, members, affixes)
- Realm / season / dungeon / item / item media / playable-spec / leaderboard: id, name/slug, links as applicable

Outbound shared DTOs: `CanonicalCharacter`, `CharacterSnapshotDTO`, `EquipmentSnapshotDTO`, `TalentSnapshotDTO`, `MythicRunDTO`, plus provider-local static records for realm/season/dungeon/class/spec.

## Cache TTL matrix

| Endpoint key | TTL | Notes |
|--------------|-----|-------|
| `oauth.token` | `expires_in - 60s` | Memory only |
| `realm.index` / `realm.get` | 7d | Dynamic but slow-changing |
| `mplus.season.index` | 24h | Current season may flip |
| `mplus.season.get` (historical) | 30d | Treat as near-immutable |
| `mplus.dungeon.index` / `dungeon.get` | 7d | |
| `character.profile` | 24h (`BLIZZARD_CHARACTER_TTL_SECONDS`) | |
| `character.equipment` | 6h | |
| `character.specializations` | 6h | |
| `character.media` | 24h | |
| `character.mplus.index` | 6h | |
| `character.mplus.season` | 6h current / 30d historical | |
| `item.get` / `item.media` | 7d | Only for requested IDs |
| `playable-spec.get` | 7d | |
| `mythic.leaderboard` | 1h | Explicit method only |
| Negative cache (404) | 30–60m | Character/realm not found |

Also: in-memory fingerprint cache, in-flight dedupe, optional ETag/`If-None-Match` / `If-Modified-Since` when headers present.

## Error mapping (agent intent → shared `ExternalApiError`)

| HTTP / condition | Shared code | retryable |
|------------------|-------------|-----------|
| 404 | `NOT_FOUND` | no |
| 401 | `UNAUTHORIZED` | no (token refresh once, then fail) |
| 403 (private/restricted) | `UNAUTHORIZED` (+ detail `PRIVATE_OR_RESTRICTED`) | no |
| 429 | `RATE_LIMITED` | yes; honor `Retry-After` |
| 5xx | `NETWORK` (detail `PROVIDER_UNAVAILABLE`) | yes |
| Timeout / DNS / reset | `TIMEOUT` / `NETWORK` | yes |
| Zod / malformed JSON | `INVALID_RESPONSE` | no |
| Missing credentials in live mode | `UNKNOWN` (detail `CONFIGURATION_ERROR`) | no |

Include safe headers (`x-request-id`, `blizzard-request-id` if present) in `details`. Never include Authorization.

## Normalization strategy

- Identity via `@mplus/domain` (`normalizeName`, `normalizeRealmSlug`, `normalizeRegion`, `toCharacterRef`, `buildRequestFingerprint`, `computeRunFingerprint`).
- Display names preserved from API `name`; keys are normalized.
- Provider IDs preserved (`blizzardCharacterId` as string from numeric `id`).
- Canonical character `id` for provider-layer DTO: stable synthetic key `blizzard:{region}:{realmSlug}:{normalizedName}` (DB UUID assignment remains Agent 5).
- Role from active spec (tank/healer/dps heuristics via playable-spec `role.type` when available; else null).
- `MythicRunDTO` from `best_runs` when present; fingerprint from region + season + dungeon + completedAt + keyLevel + duration + sorted roster keys.
- No Battle.net account inference.
- Provenance: provider `blizzard`, source URL, fetchedAt, schemaVersion `blizzard-wow-profile-2026-07`.

## Fixture strategy

Under `tools/fixtures/blizzard/`:

| Fixture | Purpose |
|---------|---------|
| `character-profile-normal.json` | Max-level EU character |
| `character-profile-accented.json` | Accented / apostrophe name |
| `character-not-found.json` | 404 body |
| `equipment-key-items.json` | Trinkets / notable items |
| `specializations-multi.json` | Multiple specs + loadout |
| `media-avatar.json` | Avatar asset |
| `mythic-keystone-profile-index.json` | Current season pointer + rating |
| `mythic-keystone-season-current.json` | Best runs |
| `partial-fields.json` | Missing optional fields |
| `realm-tarren-mill.json` | Realm metadata |
| `season-index.json` / `season-current.json` | Season static |
| `dungeon-index.json` / `dungeon-sample.json` | Dungeons |
| `item-sample.json` / `item-media-sample.json` | Item + media |
| `errors/429.json`, `errors/500.json` | Error bodies |
| `manifest.json` | Maps identity → fixture keys |

`PROVIDER_MODE=fixture` (default): `FixtureBlizzardProvider` reads these; zero network.

## Missing API capability / limitations

- Profile data updates only after character logout — freshness is Blizzard-side.
- Connected-realm mythic leaderboards cover only a limited top set; **not** used for population discovery; method exposed but never bulk-crawled.
- Account-wide character list requires authorization-code OAuth — **out of scope**.
- Blizzard M+ best_runs may omit full seasonal history Raider.IO exposes — workers must tolerate partial runs.
- Official HTML docs were not scrapeable (JS SPA); schemas verified against bootstrap templates + community namespace confirmation. Live smoke (optional) can re-validate when credentials exist.

## Package design

```
packages/providers/blizzard/src/
  index.ts              # createBlizzardProvider, exports
  config.ts             # region hosts, TTL defaults, options
  errors.ts             # mapHttpToExternalApiError
  token-manager.ts      # client-credentials + dedupe
  cache.ts              # TTL + fingerprint + inflight
  http-client.ts        # concurrency, retry, conditional GET
  schemas.ts            # Zod
  normalize.ts          # DTO mappers
  fixture-store.ts      # load tools/fixtures/blizzard
  fixture-provider.ts
  live-provider.ts
  types.ts
```

Factory: `createBlizzardProvider(mode, options?)` → fixture | live.

Optional smoke: `packages/providers/blizzard/src/smoke-live.ts` runnable only when `PROVIDER_MODE=live` and credentials set; **not** invoked by unit tests.

## Contract change request

File `doc/contracts/change-requests/01-blizzard-provider-surface.md`:

- Extend `BlizzardProvider` with methods for realm, equipment snapshot, talents, media, M+ season, seasons/dungeons/items, leaderboard (explicit).
- Keep existing three methods; clarify `getCharacterEquipment` returns snapshot-oriented DTO (existing contract) and add `getEquipmentSnapshot` for `EquipmentSnapshotDTO`.
- No Prisma changes. No breaking removals.

## Request efficiency

- Concurrency default 4 (`BLIZZARD_REQUEST_CONCURRENCY`).
- Retry idempotent GET only; exponential backoff + jitter; max 3 retries.
- Honor 429 `Retry-After`.
- Item details fetched only for caller-supplied IDs; aggressive cache.
- No leaderboard scanning loops.

## Tests (no live calls)

- Token cache + concurrent refresh (fake timers / mock fetch).
- Regional host/namespace/locale.
- URL encoding (accents, apostrophes).
- Zod validation failures → `INVALID_RESPONSE`.
- Normalization to DTOs.
- Cache hit / inflight dedupe.
- Retry/backoff with fake timers.
- Log scrub: secrets never appear in serialized logs.
- Fixture provider happy path + 404 + 429 mapping.

## Acceptance commands

```
pnpm --filter @mplus/provider-blizzard typecheck
pnpm --filter @mplus/provider-blizzard build
pnpm test -- packages/providers/blizzard
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Live smoke only if credentials present (skip otherwise — do not block).

## Documentation deliverables

- `doc/api/blizzard/overview.md`
- `doc/api/blizzard/endpoints.md`
- `doc/api/blizzard/cache-policy.md`
- `doc/api/blizzard/fixtures.md`
- `doc/api/blizzard/limitations.md`
- Replace stub `doc/api/blizzard/README.md` with index links.
- Handoff: `doc/agents/01-blizzard.md`

## Out of scope

Raider.IO, WCL, scoring, bulk leaderboards, secret storage, Armory HTML scrape, other agents' packages.
