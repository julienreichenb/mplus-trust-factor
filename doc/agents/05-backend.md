# Agent
- ID: 05
- Scope: Backend API, persistence services, worker orchestration
- Branch/worktree: agent/backend
- Date: 2026-07-27
- Commit(s): `5359163` (implementation), `1671c78` (handoff hash)

# Summary
Implemented the versioned Fastify API (SWR character profile, refresh, comparison, jobs, public score models, MVP admin) and BullMQ worker orchestration with a staged refresh DAG. Fixture provider adapters live in the worker (DI) so e2e refresh persists a score without Agents 1–3. Repositories keep Prisma out of route handlers. OpenAPI generates from route schemas. Internal docs under `doc/api/internal/`.

# Plan reference
[doc/plans/05-backend.md](../plans/05-backend.md)

# Files owned/changed
- `apps/api/**` — container, routes, services, admin auth, tests, OpenAPI
- `apps/worker/**` — DI container, fixture providers, persistence repos, refresh/analyze/recalculate/export pipelines, producers, tests
- `doc/api/internal/**`
- `doc/plans/05-backend.md`
- `doc/contracts/change-requests/05-*.md`
- Additive: `packages/contracts` (`retryable`), `packages/config` (`PUBLIC_DETAILS_ALL`), `.env.example`, `vitest.config.ts`, lockfile

# Public contracts
- API routes: see [routes.md](../api/internal/routes.md)
- Queues (unchanged names): `refresh-character`, `analyze-run`, `recalculate-score`, `generate-addon-export`
- Error envelope: optional `retryable`
- Env: `PUBLIC_DETAILS_ALL`, existing `ADMIN_API_KEY`, `MANUAL_REFRESH_COOLDOWN_SECONDS`, provider TTLs
- DB: no schema migration; uses Agent 0 models via repositories

# Acceptance results
- `pnpm install` — ok
- `pnpm lint` — pass
- `pnpm typecheck` — pass
- `pnpm test` — 39 passed, 3 todo (Agent 4), 1 skipped file
- `pnpm test:integration` — 3 passed
- `pnpm build` — pass
- `pnpm openapi:generate` — writes `apps/api/openapi.json`
- Fixture refresh pipeline → persisted `ScoreSnapshot` (worker tests)
- SWR fresh/stale/queued/404, cooldown, comparison 2–10 + model mismatch, admin auth, provider-disabled (API tests)

# External API observations
- No live provider calls; worker fixture adapters implement contract interfaces
- Agents 1–3 remain owners of `packages/providers/*`

# Security and privacy
- MVP admin key: constant-time compare; not for frontend bundles
- Serializers omit secrets/raw payloads
- Pino redaction retained
- Entitlement flag server-side (`PUBLIC_DETAILS_ALL`)

# Known limitations
- Scoring still Agent 4 placeholder (`calculateScore`)
- Fixture providers are orchestration-owned, not live-verified shapes
- Admin auth is MVP API-key only
- Detailed WCL analysis in fixture mode runs inline in the refresh pipeline (queue still available)
- Response cache is in-memory (not multi-instance Redis cache)

# Contract change requests
- [05-api-error-retryable.md](../contracts/change-requests/05-api-error-retryable.md)
- [05-public-details-all.md](../contracts/change-requests/05-public-details-all.md)

# Follow-up work
- Wire Agents 1–3 live providers into worker DI when available
- Replace MVP admin key with real auth
- Redis-backed response cache for multi-instance API
- Agent 10 e2e with real compose stack

# Rollback
- Revert this branch/commit
- Disable worker processors or set providers disabled via container overrides
- Turn off public details with `PUBLIC_DETAILS_ALL=false` if needed for exposure control
