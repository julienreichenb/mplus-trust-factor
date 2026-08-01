# Wave 3 operations

Concise runbook for live Wave 3 (Blizzard + Raider.IO + Warcraft Logs, fusion, scoring v2).

## Prerequisites

- Node.js 22+ (24 preferred; see `.nvmrc`)
- pnpm 10 (`packageManager` field; prefer Corepack)
- Docker Desktop for PostgreSQL 16 and Redis 7

## Required environment

| Variable | Notes |
|----------|--------|
| `DATABASE_URL` | PostgreSQL (local compose uses host port **5433**) |
| `REDIS_URL` | Required when API/worker use BullMQ (`queueMode=bullmq`) |
| `ADMIN_API_KEY` | Admin routes (override the `.env.example` placeholder in real deploys) |
| `SESSION_SECRET` | ≥32 chars (override placeholder in real deploys) |
| `PROVIDER_MODE` | `fixture` (default) or `live` |
| `ACTIVE_SCORE_MODEL_KEY` / `ACTIVE_SCORE_MODEL_VERSION` | Prefer `default` / `2` for Wave 3 |

Copy `.env.example` → `.env`. Never put provider secrets in `VITE_*` or tracked files.

## Optional providers

| Flag | Credentials |
|------|-------------|
| `BLIZZARD_ENABLED` | `BLIZZARD_CLIENT_ID` + `BLIZZARD_CLIENT_SECRET` required when live+enabled |
| `RAIDERIO_ENABLED` | `RAIDERIO_APP_KEY` optional |
| `WCL_ENABLED` | `WCL_CLIENT_ID` + `WCL_CLIENT_SECRET` required when live+enabled |

Disable a provider with `*_ENABLED=false` instead of omitting credentials while leaving it enabled.

Wowhead tooltips remain **off by default** (`VITE_WOWHEAD_ENABLED`).

## Clean build procedure

From a clean clone (or after deleting package `dist/` trees):

```bash
pnpm bootstrap
pnpm build
pnpm typecheck
```

`pnpm bootstrap` covers worktree-aware `.env` setup, live local-dev defaults (`PROVIDER_MODE=live`, provider enable flags, `UTILITY_PUBLICATION_MODE=published`, and `VITE_API_MODE=live` in `apps/web/.env`), install, Compose infra, Prisma generate, workspace package `dist` builds, migrate and seed. For a full monorepo emit (apps included), still run `pnpm build` afterward.

Workspace packages export from `dist/`. `pnpm build` (`pnpm -r --if-present run build`) builds packages in dependency order via pnpm workspace graph. Do not commit `dist/` or `openapi.json` (gitignored).

## Local startup

```bash
pnpm bootstrap
pnpm dev
```

- API: `http://localhost:3000`
- Web: `http://localhost:5173`
- Docs: `http://localhost:3000/docs`

## Database migration and seed

Migrations (ordered):

1. `20260727000000_init` — baseline schema
2. `20260727180000_character_provider_states` — provider lifecycle / WCL visibility columns (**additive**, non-destructive)

```bash
pnpm db:migrate   # prisma migrate deploy
pnpm db:seed      # idempotent; activates default model v2, archives other ACTIVE default versions
```

Seed does **not** insert Wallidrixe or other live characters. Historical score snapshots retain their `modelVersion` and are not rewritten.

Destructive migration risk: **none** for Wave 3’s additive provider-state migration. Resetting a local DB (`docker compose down -v`) destroys all local data.

## Health checks

| Endpoint | Behavior |
|----------|----------|
| `GET /health/live` | Process liveness only. **Never** depends on providers, DB, or Redis. |
| `GET /health/ready` | Local infrastructure readiness. |

Ready payload (no secrets):

- `database.ok` / `latencyMs`
- `redis.ok` / `latencyMs` (or `skipped: true` when API runs with inline queues / tests)
- `queueMode`: `bullmq` \| `inline`
- `providers.*.enabled` / `configured` (booleans only)

### Expected failure modes

| Condition | live | ready |
|-----------|------|-------|
| PostgreSQL down | 200 | 503 `database.ok=false` |
| Redis down (BullMQ mode) | 200 | 503 `redis.ok=false` |
| Missing provider credentials (live+enabled) | Process may fail at startup | N/A — fix env or disable provider |
| Optional provider disabled | 200 | 200; that provider `enabled=false` |
| Scoring model seed missing/stale | 200 | 200; refresh jobs fail until `pnpm db:seed` |

## Queue recovery / stale QUEUED

- Logical dedupe is on `IngestionJob.dedupeKey`; each BullMQ execution uses a **unique** job id.
- Concurrent refresh requests collapse onto an active `QUEUED`/`ACTIVE` row.
- Failed enqueue must not leave a false `QUEUED` public state (producers mark failed on hard errors).
- **Stale QUEUED** (never started past threshold) is failed so a new execution can proceed — see job repository staleness helpers.
- Worker return values are JSON-safe (BigInt → string) and sanitized (no tokens / raw `reportCode`).

## Provider degradation

One provider failure must not unnecessarily fail the whole profile (Blizzard remains the identity gate).

### WCL provenance (do not conflate)

- `wclVisibility`: `PUBLIC` \| `HIDDEN` \| `null` — `HIDDEN` only when upstream `hidden=true`
- `wclDataState`: `MATCHED_COMBAT_LOGS` \| `RANKINGS_ONLY` \| `NO_MATCHED_RUN` \| `NO_PUBLIC_LOGS` \| `UNAVAILABLE` \| `RATE_LIMITED`
- Zone rankings may contribute without matched combat logs (`ZONE_RANKINGS`)
- Missing data must not be shown as poor performance (null ≠ 0)

## WCL zone ID and expiry

| Variable | Role |
|----------|------|
| `WCL_MPLUS_ZONE_ID` | Current Mythic+ zone for `zoneRankings` (required in live; example uses `47`) |
| `WCL_MPLUS_ZONE_EXPIRES_AT` | **Recommended** ISO datetime. When unset → warning log. When past expiry → zone rankings skipped (bounded recent reports only). |

Do **not** invent an expiry value in application code. Operators set it when the season zone is confirmed. See `packages/providers/warcraftlogs/src/discovery/mplus-zone.ts`.

## Scoring model seed

```bash
pnpm db:seed
```

Wave 3 expects model **v2** for PERFORMANCE based on current-season WCL Best % / Median %. Model **v1** remains archived and distinguishable. Historical snapshots keep their `modelVersion`.

Seed creates a bootstrap `placeholder-current` season row for empty databases. Live/fixture refreshes replace the active season via `ensureBlizzardCurrentSeason` (not used for scoring while Blizzard season is known).

## Safe smoke diagnostics

```bash
ALLOW_LIVE_PROVIDER_CALLS=true
pnpm live:smoke:character -- --region EU --realm <realm-slug> --name <character>
```

Structured events (filterable):

- `refresh.worker.started`, `refresh.dedupe`, `refresh.provider.phase.*`
- `refresh.fusion.completed`, `refresh.score.calculated`
- `refresh.persistence.completed`, `refresh.terminal`

Correlation: API `x-request-id` / request id → job `correlationId` → provider `ProviderFetchContext`.

Do **not** dump: OAuth tokens, Authorization headers, DB/Redis URLs, raw report codes, full rosters, stack traces to clients.

## Known limitations

- Live smokes require `ALLOW_LIVE_PROVIDER_CALLS=true` and an explicit identity (no default player).
- Raider.IO season-cutoffs may soft-fail (non-blocking warning).
- Blizzard media/equipment/talents soft-skip independently.
- Frontend polling stops on terminal job/profile states (max ~120s); no infinite poll.
- Dashboards/alerts beyond Prometheus `/metrics` are not shipped in MVP.
- Utility mechanic catalog / class-spec calibration incomplete.
- Addon export is a separate workstream.

## Rollback procedure

1. **Do not merge** if blockers remain; keep serving `main`.
2. If `integration/wave3` was merged to `main`:
   - Revert the merge commit on `main` (`git revert -m 1 <merge-sha>`), or redeploy the previous `main` SHA.
   - Database: Wave 3’s additive `character_provider_states` migration can remain (safe unused table) or be dropped manually only if required — dropping is optional and not required for app rollback to Wave 2 binaries that ignore the table.
   - Re-seed is not required for rollback; leave historical snapshots intact.
3. Disable a misbehaving live provider with `*_ENABLED=false` without a full rollback.

See also: [local-development.md](./local-development.md), [../testing/observability.md](../testing/observability.md), [../release/known-limitations.md](../release/known-limitations.md).
