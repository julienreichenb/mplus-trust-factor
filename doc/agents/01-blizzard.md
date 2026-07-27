# Agent
- ID: 01
- Scope: Blizzard / Battle.net provider integration
- Branch/worktree: `agent/blizzard`
- Date: 2026-07-27
- Commit(s): `9058f6f`

# Summary
Implemented a typed Blizzard provider for EU (region-ready) with OAuth client-credentials token manager, HTTP cache/dedupe/retry, Zod boundary validation, DTO normalization, sanitized fixtures, fixture + live modes, API docs, and unit tests. No live API calls in tests; live smoke skips cleanly without credentials.

# Plan reference
[doc/plans/01-blizzard.md](../plans/01-blizzard.md)

# Files owned/changed
- `packages/providers/blizzard/**` — full client implementation
- `tools/fixtures/blizzard/**` — sanitized fixtures + manifest
- `doc/api/blizzard/**` — overview, endpoints, cache, fixtures, limitations
- `doc/plans/01-blizzard.md`
- `doc/contracts/change-requests/01-blizzard-provider-surface.md`
- `packages/contracts/src/provider.ts` — additive `BlizzardProvider` extension + DTOs
- `tools/fixtures/providers.json` — pointer to blizzard fixture root
- `vitest.config.ts` — `@mplus/provider-blizzard` alias

# Public contracts
- Extended `BlizzardProvider` (additive): realm, equipment/talent snapshots, media, M+ index/season, season/dungeon indexes, items-by-id, explicit leaderboard
- New DTOs: `BlizzardRealmDTO`, `BlizzardSeasonDTO`, `BlizzardDungeonDTO`, `BlizzardItemDTO`, `BlizzardCharacterMediaDTO`, `BlizzardMythicKeystoneProfileDTO`, `BlizzardMythicLeaderboardDTO`
- Factory: `createBlizzardProvider("fixture" | "live", options?)`
- Env (existing): `PROVIDER_MODE`, `BLIZZARD_CLIENT_ID/SECRET`, `BLIZZARD_DEFAULT_REGION/LOCALE`, `BLIZZARD_REQUEST_CONCURRENCY`, `BLIZZARD_CHARACTER_TTL_SECONDS`
- No Prisma changes; no new queue names

# Acceptance results
- `pnpm install` — ok
- `pnpm db:generate` — required after install (ignored prisma build scripts)
- `pnpm lint` — pass
- `pnpm typecheck` — pass
- `pnpm test` — 31 passed, 3 todo (Agent 4 scoring)
- `pnpm build` — pass
- `pnpm --filter @mplus/provider-blizzard smoke:live` — SKIP (no credentials)
- Blizzard unit tests: 22 passed (no live network)

# External API observations
- Docs URLs: develop.battle.net + community.developer.battle.net guides (OAuth, regionality, profile, game-data)
- Portal HTML is JS-gated; namespaces confirmed (`profile-{region}`, `dynamic-{region}`, `static-{region}`) via bootstrap + Blizzard forum guidance
- Schema version tag: `blizzard-wow-profile-2026-07`
- Token: `POST https://oauth.battle.net/token`, Basic auth, client_credentials
- EU host: `https://eu.api.blizzard.com`, locale `en_GB`
- Cache TTLs documented in `doc/api/blizzard/cache-policy.md`
- Index methods intentionally do not cascade into every detail (avoids bulk)

# Security and privacy
- Secrets never logged by token manager; observability already redacts `BLIZZARD_CLIENT_SECRET` / tokens
- Fixtures are fictional sanitized shapes
- Tokens memory-cached only until near expiry

# Known limitations
- Profile freshness tied to character logout
- Leaderboard method present but must not be bulk-crawled
- Account-wide OAuth (authorization code) out of scope
- M+ `best_runs` may be incomplete vs Raider.IO
- Live schema not re-validated against a live credentialed call in this environment

# Contract change requests
- [doc/contracts/change-requests/01-blizzard-provider-surface.md](../contracts/change-requests/01-blizzard-provider-surface.md) (applied, additive)

# Follow-up work
- Run `pnpm --filter @mplus/provider-blizzard smoke:live` when credentials are available to confirm live schemas
- Agent 5 wires provider into worker refresh DAG
- Optional: negative-cache persistence in Redis (currently in-memory per process)

# Rollback
- Revert this branch/commit
- Or force `PROVIDER_MODE=fixture` / stop importing `@mplus/provider-blizzard` live factory
