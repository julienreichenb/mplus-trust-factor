# Agent 5 — Backend API, Persistence, Worker Orchestration Plan

## Scope

Own and implement:

- `apps/api/**` — versioned Fastify routes, OpenAPI, admin auth, SWR responses
- `apps/worker/**` — BullMQ processors, fixture provider DI, refresh DAG
- Orchestration repositories/services (under api/worker, not Prisma-in-routes)
- `doc/api/internal/**`

Out of scope: provider live integrations (1–3), scoring formulas (4), web/addon/devops/qa.

## Current baseline (Agent 0)

- Health + `/api/v1/meta` + OpenAPI skeleton
- Four queues with `NotImplemented` processors
- Contracts for identity/runs/provider/scoring/jobs/API DTOs
- Prisma schema + seed (EU, placeholder season, model `default` v1)
- Provider packages throw `NotImplemented` even in fixture mode

## Architecture decisions

### Dependency injection

`createAppContainer(env, overrides?)` (API) and `createWorkerContainer(env, overrides?)` (worker) wire:

| Port | Default | Test override |
|------|---------|---------------|
| Prisma | `@mplus/database` | injected client |
| Redis / BullMQ | `REDIS_URL` | fake queue / memory |
| Blizzard / WCL / Raider.IO | **Worker-owned fixture adapters** implementing `@mplus/contracts` interfaces | stubs / disabled |
| Scoring | `@mplus/scoring.calculateScore` | fake calculator |
| Response cache | Redis-backed (in-memory fallback) | Map |

Real provider packages remain Agent 1–3 owned. Worker fixture adapters satisfy e2e without editing those packages.

### Repository boundaries

No Prisma in route handlers. Repositories (shared via `@mplus/worker` exports consumed by API):

- `CharacterRepository` — resolve/upsert identity, snapshots, freshness timestamps
- `RealmRepository` — search realms by region/query
- `RunRepository` — transactional upsert run + sources + participants; latest/highest selection
- `MetricRepository` — observations
- `ScoreRepository` — models, snapshots + dimensions, red flags (transactions)
- `JobRepository` — `IngestionJob` persistence + status
- `ExternalRequestRepository` — request/payload metadata (no raw secrets)
- `AddonExportRepository` — export metadata
- `MechanicRuleRepository` — minimal admin CRUD

### Worker DAG (maps to existing queue contracts)

Keep Agent 0 queue names. Refresh is a staged pipeline inside `refresh-character`:

```text
resolve-character
  → refresh-blizzard
  → refresh-raiderio
  → refresh-warcraftlogs-summary
  → match-detailed-runs
  → [enqueue analyze-run per selected run, deduped]
  → extract-metrics (after analyses or with fixture metrics)
  → calculate-score
  → refresh-character-finalize
```

Sibling queues:

- `analyze-run` — analyze-wcl-run stage (fixture report details)
- `recalculate-score` — calculate-score for admin/model activation
- `generate-addon-export` — export metadata + prune-raw-artifacts

Provider-disabled: stage skipped, provenance recorded, refresh continues; score confidence reduced / red flag `insufficient_data` or `logs_hidden` as appropriate.

### Stale-while-revalidate

| State | HTTP | Behavior |
|-------|------|----------|
| Fresh score within TTL | 200 | `refreshStatus=FRESH` |
| Score present, past TTL | 200 | `refreshStatus=STALE`, enqueue refresh (deduped) |
| No score, job active | 202 | profile/job payload, `QUEUED`/`IN_PROGRESS` |
| Confirmed not found (negative cache) | 404 | no enqueue storm |
| Invalid identity input | 400 | validation error |

Source freshness exposed via `sources[]`. Detailed WCL never blocks page GET.

TTL defaults: character profile from `BLIZZARD_CHARACTER_TTL_SECONDS` / provider TTLs; overall “fresh” uses `lastPublicRefreshAt` vs configured TTL.

### Job idempotency

- BullMQ `jobId` = dedupe key from existing helpers (`refreshCharacterDedupeKey`, etc.)
- `IngestionJob.dedupeKey` unique — return existing active/queued job
- Manual refresh: cooldown `MANUAL_REFRESH_COOLDOWN_SECONDS`; return existing job + `cooldownSecondsRemaining`
- DB writes use unique constraints (character identity, run fingerprint, score fingerprint)

### Error / status semantics

Standard envelope (extend contract with optional `retryable`):

```json
{ "error": { "code", "message", "requestId", "retryable", "details?" } }
```

Worker retry classification:

| Class | Action |
|-------|--------|
| Transient (`TIMEOUT`, `NETWORK`) | retry + exponential backoff |
| `RATE_LIMITED` | delay using Retry-After when present |
| `NOT_FOUND` | negative cache; fail job without rapid retry |
| `INVALID_RESPONSE` | dead-letter / mark FAILED for review |
| Provider disabled | soft-skip stage |

Correlation: `x-request-id` → job payload `requestedAt` + stored `correlationId` in payload JSON.

### Admin auth (MVP-only)

- Header `x-admin-api-key` compared with `timingSafeEqual` to `ADMIN_API_KEY`
- Documented as MVP-only; never shipped to frontend bundles
- Entitlements: server-side serializer flag `PUBLIC_DETAILS_ALL=true` default (config) omits premium fields when false

### OpenAPI plan

Every route registers Fastify JSON Schema (request + responses including 4xx examples).

Examples in docs: fresh, stale, queued, no logs, insufficient data.

Artifact: existing `pnpm openapi:generate` → `apps/api/openapi.json`.

### Route map

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/v1/meta` | existing |
| GET | `/api/v1/realms` | `region`, `query` |
| GET | `/api/v1/characters/search` | identity search |
| GET | `/api/v1/characters/:region/:realm/:name` | SWR profile |
| POST | `.../refresh` | enqueue, cooldown, dedupe |
| GET | `.../refresh-status` | |
| GET | `.../history` | score snapshot history |
| GET | `.../runs` | `kind=latest\|highest` |
| GET | `.../scores` | latest score DTO |
| POST | `/api/v1/comparisons` | 2–10 identities; reject mixed model versions |
| GET | `/api/v1/score-models/public` | active public models |
| GET/POST | `/api/v1/admin/score-models` | admin |
| POST | `/api/v1/admin/score-models/:id/validate` | |
| POST | `/api/v1/admin/score-models/:id/backtest` | fixture cohort stub |
| POST | `/api/v1/admin/score-models/:id/activate` | + recalculate queue |
| POST | `/api/v1/admin/characters/:id/recalculate` | |
| CRUD | `/api/v1/admin/mechanic-rules` | minimal |
| GET | `/api/v1/jobs/:id` | |

Rate limit: `@fastify/rate-limit` per IP on refresh/search.

## Contract change requests

1. `ApiErrorEnvelope.error.retryable?: boolean` — backward compatible
2. Optional profile enrichment fields only if existing DTO insufficient — prefer mapping into current `CharacterProfileResponse` + score DTO

## Testing plan

- Fastify inject: routes, admin auth, comparison validation, cooldown, provider-disabled, secrets not leaked
- Repository integration tests (Postgres)
- Queue orchestration with fixture providers (e2e refresh → persisted score)
- Idempotency / SWR / graceful shutdown
- OpenAPI generate buildable

## Assumptions

- Agents 1–3 fixtures remain stubs; Agent 5 ships working fixture adapters in worker
- Agent 4 scoring remains placeholder `calculateScore` — sufficient for persisted score e2e
- Seeded EU region + placeholder season + model v1 required for tests
- No Prisma schema changes unless blocked (prefer change-request)

## Self-review checklist

- [x] Routes cover Agent 5 prompt without owning provider/scoring internals
- [x] DI + fixtures for unavailable providers
- [x] Repositories keep Prisma out of handlers
- [x] SWR / dedupe / cooldown / retry classification specified
- [x] Admin MVP auth constant-time
- [x] Docs paths match handoff template
- [x] No Wave-1 ownership violations (no edits to provider packages / scoring formulas)

## Implementation order

1. Worker container, fixture providers, repositories, refresh DAG processors
2. Queue producers + job status helpers exported for API
3. API container, routes, auth, cache, error model
4. Tests + OpenAPI
5. `doc/api/internal/*` + `doc/agents/05-backend.md`
6. Lint / typecheck / test / build; commit
