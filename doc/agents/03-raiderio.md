# Agent
- ID: 03
- Scope: Raider.IO minimal provider
- Branch/worktree: current branch (03-raiderio)
- Date: 2026-07-27
- Commit(s): pending

# Summary

Implemented a minimal, replaceable Raider.IO provider (`@mplus/provider-raiderio`) with fixture and live modes, in-memory cache/rate limiting, normalized DTOs, boost-support facts for Agent 4, sanitized fixtures, and full API documentation. No scraping, no bulk `/runs` ingestion. Provider disable via `RAIDERIO_ENABLED=false`.

# Plan reference

[doc/plans/03-raiderio.md](../plans/03-raiderio.md)

# Files owned/changed

- `packages/providers/raiderio/**` — full provider implementation + tests
- `packages/contracts/src/raiderio.ts` — additive normalized DTOs
- `packages/contracts/src/provider.ts` — extended `RaiderIoProvider`
- `packages/config/src/index.ts` — Raider.IO TTL/enabled env vars
- `.env.example` — new Raider.IO settings
- `tools/fixtures/raiderio/**` — 9 sanitized fixtures
- `tools/fixtures/providers.json` — fixture index
- `doc/api/raiderio/**` — 6 documentation files
- `doc/contracts/change-requests/03-raiderio-types.md`
- `doc/architecture/contracts.md` — Raider.IO section
- `vitest.config.ts` — provider alias

# Public contracts

## New types (`@mplus/contracts`)

- `RaiderIoAttribution`, `RaiderIoCharacterProfile`, `RaiderIoSeasonCutoffs`, `RaiderIoStaticData`, `RaiderIoRunDetails`, `RaiderIoPeriod`, `RaiderIoBoostSupportFacts`, and supporting types

## Extended interface

`RaiderIoProvider`:

- `enabled: boolean`
- `getCharacterProfile`, `getSeasonCutoffs`, `getStaticData`, `getRunDetails`, `getPeriods`

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `RAIDERIO_ENABLED` | `true` | Disable provider entirely |
| `RAIDERIO_SOFT_RPM` | `60` | Internal soft rate limit |
| `RAIDERIO_REQUEST_CONCURRENCY` | `2` | Max in-flight requests |
| `RAIDERIO_CHARACTER_TTL_SECONDS` | `43200` | Profile cache TTL |
| `RAIDERIO_NEGATIVE_CACHE_SECONDS` | `2700` | 404 negative cache |
| `RAIDERIO_CUTOFFS_TTL_SECONDS` | `86400` | Cutoffs cache |
| `RAIDERIO_STATIC_DATA_TTL_SECONDS` | `604800` | Static data cache |

# Acceptance results

| Command | Result |
|---------|--------|
| `pnpm install` | ok |
| `pnpm db:generate` | ok (Prisma client) |
| `pnpm lint` | pass |
| `pnpm typecheck` | pass |
| `pnpm test` | 31 passed, 3 todo (Agent 4) |
| `pnpm test:integration` | 3 passed |
| `pnpm build` | pass |

Raider.IO-specific: 22 new tests across fields, rate limiter, cache, HTTP client, normalization, and fixture provider.

# External API observations

- OpenAPI **v0.62.5** verified from `https://raider.io/swagger.json`
- Minimal `fields` string documented in `doc/api/raiderio/minimal-call-matrix.md`
- `cutoffs.p750` = top 25% regional threshold
- Live `season-cutoffs?region=eu` returned HTTP 500 during verification — fixtures used
- No live-tracking or `/runs` endpoints implemented

# Security and privacy

- `RAIDERIO_APP_KEY` redacted in logs via observability paths
- Fixtures contain fictional character names only
- No real player payloads committed
- Fixture mode default for CI/tests

# Known limitations

- In-memory cache only (Redis/Postgres persistence deferred to Agent 5)
- Worker orchestration not wired (Agent 5)
- Live provider not exercised in CI
- `getRunDetails` defaults region to `EU` when not in response
- Negative cache helper defined but not fully wired for live NOT_FOUND paths

# Contract change requests

- [doc/contracts/change-requests/03-raiderio-types.md](../contracts/change-requests/03-raiderio-types.md)

# Follow-up work

- Agent 5: wire provider into refresh DAG step B with budget controller
- Agent 4: consume `RaiderIoBoostSupportFacts` / `extractBoostSupportFacts`
- Agent 6: display `RaiderIoAttribution` on character profile
- Contact Raider.IO before commercial launch

# Rollback

1. Set `RAIDERIO_ENABLED=false` in environment
2. Revert Agent 3 commit(s)
3. Workers skip Raider.IO; system continues with Blizzard/WCL only (reduced richness)
