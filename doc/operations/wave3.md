# Wave 3 operations

Concise runbook for live Wave 3 (Blizzard + Raider.IO + Warcraft Logs, fusion, scoring v2).

## Required environment

| Variable | Notes |
|----------|--------|
| `DATABASE_URL` | PostgreSQL (local compose uses host port **5433**) |
| `REDIS_URL` | Required when API/worker use BullMQ (`queueMode=bullmq`) |
| `ADMIN_API_KEY` | Admin routes |
| `SESSION_SECRET` | ≥32 chars |
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

## Local startup

```bash
pnpm install
cp .env.example .env
pnpm dev:infra
pnpm db:generate && pnpm db:migrate && pnpm db:seed
pnpm dev
```

- API: `http://localhost:3000`
- Web: `http://localhost:5173`
- Docs: `http://localhost:3000/docs`

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

## Queue recovery

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

## Scoring model seed

```bash
pnpm db:seed
```

Wave 3 expects model **v2** for PERFORMANCE based on current-season WCL Best % / Median %. Historical snapshots keep their `modelVersion` and are not silently rewritten.

## WCL zone configuration

Zone ids / season windows are configured in provider + env (see `.env.example` WCL section). Respect expiry and rate budget; hydration is **bounded** (report/fight/event caps). Never log raw report codes — use fingerprints/masked ids.

## Safe diagnostics

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

See also: [local-development.md](./local-development.md), [../testing/observability.md](../testing/observability.md).
