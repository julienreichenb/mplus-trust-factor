# Agent
- ID: 00
- Scope: Foundation, contracts, repository bootstrap
- Branch/worktree: master (foundation baseline)
- Date: 2026-07-27
- Commit(s): pending user commit

# Summary
Bootstrapped the pnpm TypeScript monorepo with shared contracts, Prisma schema + initial migration + idempotent seed, Fastify/Vue/BullMQ skeletons, provider/scoring/mechanics stubs, Docker Compose for Postgres/Redis, docs/ADRs, and fixture-mode tests. No live provider integrations or final scoring.

# Plan reference
[doc/plans/00-foundation.md](../plans/00-foundation.md)

# Files owned/changed
- Root workspace: `package.json`, `pnpm-workspace.yaml`, `tsconfig*`, ESLint/Prettier/Vitest, `.env.example`, `.nvmrc`, `README.md`
- `apps/api`, `apps/web`, `apps/worker`
- `packages/config`, `contracts`, `database`, `domain`, `observability`, `scoring`, `mechanics`
- `packages/providers/{blizzard,warcraftlogs,raiderio}`
- `tools/addon-exporter`, `tools/fixtures`, `tools/scripts`
- `addon/MPlusTrust`
- `infra/docker`
- `doc/**`

# Public contracts
- Identity / runs / provider / scoring / jobs / API DTOs in `@mplus/contracts`
- Queue names: `refresh-character`, `analyze-run`, `recalculate-score`, `generate-addon-export`
- API routes: `GET /health/live`, `GET /health/ready`, `GET /api/v1/meta`, OpenAPI at `/docs`
- Database: full initial Prisma model set + lean BattleNet account tables
- Env: see `.env.example` (`PROVIDER_MODE=fixture|live`)

# Acceptance results
- `pnpm install` — ok (local pnpm 10.14.0)
- `pnpm dev:infra` — Postgres (host **5433**) + Redis healthy
- `pnpm db:migrate` / seed — applied `20260727000000_init`; seed idempotent
- `pnpm lint` — pass (0 errors)
- `pnpm typecheck` — pass
- `pnpm test` — 9 passed, 3 todo (Agent 4 scoring)
- `pnpm test:integration` — 3 passed
- `pnpm build` — pass
- `pnpm openapi:generate` — writes `apps/api/openapi.json`

# External API observations
- No live provider calls in Agent 0
- Fixtures placeholders under `tools/fixtures/providers.json`

# Security and privacy
- `.env` gitignored; `.env.example` committed
- Pino/Fastify redaction paths for secrets
- Fixture mode default for automated tests

# Known limitations
- Worker processors explicitly `NotImplemented`
- Scoring is a neutral placeholder; Agent 4 owns real engine
- Provider packages are interface stubs only
- Host may have local Postgres on 5432 — Compose uses **5433**
- Node 24 pinned in `.nvmrc`; local smoke verified on Node 22
- Production CI/CD / Caddy / GHCR deferred to Agent 8

# Contract change requests
None.

# Follow-up work
- Agents 1–9 on isolated branches after this baseline is merged
- Replace placeholder season with live season metadata before production scoring

# Rollback
- Revert the foundation commit / branch
- `pnpm dev:infra:down` and remove Docker volumes if needed
