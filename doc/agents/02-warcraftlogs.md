# Agent
- ID: 02
- Scope: Warcraft Logs GraphQL provider and run analysis inputs
- Branch/worktree: agent/warcraftlogs
- Date: 2026-07-27
- Commit(s): pending

# Summary
Implemented the full `@mplus/provider-warcraftlogs` package: OAuth token management, typed GraphQL client with fingerprinting and Zod validation, character/run discovery, latest/highest selection, cross-provider run matching, paginated event fetching, normalized `RunCombatFacts`, rate-budget gating, revision caching, fixture mode with 10 sanitized scenarios, 18 unit tests, API documentation, and optional live smoke script.

# Plan reference
[doc/plans/02-warcraftlogs.md](../plans/02-warcraftlogs.md)

# Files owned/changed
- `packages/providers/warcraftlogs/**` — full provider implementation
- `tools/fixtures/warcraftlogs/**` — sanitized GraphQL fixtures
- `tools/scripts/wcl-smoke.mjs` — optional live smoke (skips without credentials)
- `doc/api/warcraftlogs/**` — integration documentation
- `doc/plans/02-warcraftlogs.md`
- `doc/contracts/change-requests/02-warcraftlogs-extended-provider.md`
- `vitest.config.ts` — alias for provider package
- `package.json` — `wcl:smoke` script
- `tools/fixtures/providers.json` — WCL fixture index

# Public contracts
- **Unchanged** `@mplus/contracts` `WarcraftLogsProvider` interface
- New exports from `@mplus/provider-warcraftlogs`: WCL DTOs, discovery/matching helpers, `createWarcraftLogsProvider(mode, env)`
- Env vars: existing `WCL_*` set (no new required vars)
- Optional smoke env: `WCL_SMOKE_CHARACTER_NAME`, `WCL_SMOKE_REALM_SLUG`, `WCL_SMOKE_REGION`

# Acceptance results
- `pnpm install` — ok
- `pnpm lint` — pass
- `pnpm typecheck` — pass (after `pnpm db:generate`)
- `pnpm test` — 27 passed, 3 todo (Agent 4 scoring)
- `pnpm build` — pass
- `pnpm wcl:smoke` — SKIP (fixture mode, no credentials)

# External API observations
- Character resolution via `characterData.character(name, serverSlug, serverRegion)` → `canonicalID`, `hidden`
- M+ rankings via `zoneRankings(zoneID, metric: playerscore, byBracket: true)` with `report.code`, `fightID`, `bracket`
- Recent public reports via `recentReports(limit, page)` with `visibility` filter
- Report analysis via combined metadata + `masterData(translate: false)` + filtered paginated `events`
- Rate limit via `rateLimitData` — soft thresholds from env
- **Gap:** current season M+ `zoneID` uses MVP config/default; live worldData lookup deferred to Agent 5

# Security and privacy
- Client secret server-side only; token cached in memory with expiry margin
- Public API only (`/api/v2/client`); no private user API
- Fixtures sanitized; no real player payloads committed
- GraphQL fingerprints exclude tokens

# Known limitations
- Encounter→dungeon mapping is static MVP map
- Live `getReportFightDetails` uses `WCL_DEFAULT_CHARACTER_NAME/REALM` env for actor resolution
- Raw artifact compression/storage abstraction stubbed — normalized facts returned inline; worker persistence is Agent 5
- No live API calls in CI; smoke skips without credentials

# Contract change requests
- [doc/contracts/change-requests/02-warcraftlogs-extended-provider.md](../contracts/change-requests/02-warcraftlogs-extended-provider.md) — additive extended provider methods deferred to integration

# Follow-up work
- Agent 5: wire provider into worker refresh DAG, persist rate snapshots and combat facts
- Agent 5: resolve live M+ zone ID from season/worldData
- Agent 10: optionally promote WCL DTOs into `@mplus/contracts`

# Rollback
- Revert `agent/warcraftlogs` branch commits
- Set `PROVIDER_MODE=fixture` (default) — worker falls back to fixture stubs if provider factory unchanged
