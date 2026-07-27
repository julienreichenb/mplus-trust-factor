# Agent 0 — Foundation Plan

## Current state

The repository contains only the Cursor multi-agent starter pack (root `*.txt`, `agents/*`, `manifest.json`) on `master`. No `apps/`, `packages/`, `doc/`, or `infra/` yet. Local machine may be on Node 22; Active LTS is Node 24. pnpm is pinned via `packageManager` and Corepack (or local install).

## Exact repository tree

```text
apps/
  api/                 # Fastify app factory, health, meta, OpenAPI
  web/                 # Vue 3 + Vite + Router + Pinia shell
  worker/              # BullMQ queues + NotImplemented processors
packages/
  config/              # Zod env validation, shared settings
  database/            # Prisma schema, client, seed, health query
  domain/              # Pure domain helpers (identity normalize, fingerprints)
  contracts/           # Stable DTOs/interfaces (no provider leakage)
  observability/       # Pino factory, request-id helpers, redaction
  providers/
    blizzard/          # Interface + fixture stubs
    warcraftlogs/      # Interface + fixture stubs
    raiderio/          # Interface + fixture stubs
  scoring/             # calculateScore placeholder + Agent-4-owned pending test
  mechanics/           # Mechanic catalog types/skeleton
tools/
  addon-exporter/      # CLI skeleton (no real export)
  fixtures/            # Sanitized provider fixtures for PROVIDER_MODE=fixture
  scripts/             # Monorepo helper scripts
addon/
  MPlusTrust/          # Minimal WoW addon stub (no HTTP)
doc/
  bootstrap/           # Copied/synthesized starter context
  architecture/        # system, contracts, database, parallel-ownership
  adr/                 # monorepo, Fastify, Prisma, BullMQ, artifacts
  api/                 # placeholder dirs for agents 1–3,5
  agents/              # 00-foundation.md handoff (AGENT-OUTPUT-TEMPLATE)
  plans/               # 00-foundation.md
  operations/          # local-development.md
  scoring/ testing/ contracts/change-requests/
infra/
  docker/              # compose for postgres+redis; API/worker Dockerfiles (local only)
  caddy/               # placeholder for Agent 8
  scripts/
```

Root: `package.json` (pnpm workspaces), `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig.base.json`, `.nvmrc`, `.npmrc`, `.gitignore`, `.env.example`, `README.md`, ESLint/Prettier/Vitest configs.

## Selected package versions (why)

| Piece | Target | Why |
|-------|--------|-----|
| Node | **24** (Active LTS, pin in `.nvmrc` + Docker `node:24-bookworm-slim`) | Required by Agent 0 |
| pnpm | **10.x** via `packageManager` + Corepack | Workspace standard |
| TypeScript | **5.x** strict | Shared contracts safety |
| Fastify | **5.x** | Current stable; schema-first OpenAPI |
| Vue / Vite / Router / Pinia | **Vue 3 + Vite 6+ + vue-router 4 + pinia** | Architecture baseline |
| Prisma | **6.x** | Migrations + typed client; simpler Postgres wiring than 7 |
| BullMQ + ioredis | **BullMQ 5 + ioredis 5** | Queue/cache contract |
| Zod | **3.x** | Env + job payload validation |
| Vitest | **3.x** | Unit + API inject tests |
| Test DB | Compose Postgres | Windows-friendly |

## Shared contracts

Export Identity, Runs, Provider, Metrics/scoring, Jobs, and API DTOs/interfaces per Agent 0 prompt.

Rules:

- ISO timestamps at boundaries; explicit `| null` vs optional `?`
- Region on every identity key
- Score DTOs always include `modelKey`, `modelVersion`, `calculatedAt`
- No provider-specific response shapes in public API DTOs
- `DetailedRunSelection`: `LATEST` | `HIGHEST` + same-run dedupe
- Provider packages implement contracts interfaces; return `ProviderResult<T>` + `SourceProvenance`

## Prisma / migration plan

Single initial migration covering all required models plus lean `BattleNetAccount` / `AccountCharacter`.

Idempotent seed: EU region, placeholder current season, score model `default` v1, grade thresholds, metric definitions, red-flag definitions.

## App skeletons

- API: health live/ready, meta, OpenAPI, error envelope, request ID, CORS, Pino — no live providers
- Worker: named queues, typed payloads, NotImplemented processors in development
- Web: `/`, `/character/:region/:realm/:name`, `/compare`, `/admin/models`
- Scoring: neutral placeholder + Agent-4-owned todo test

## Local developer workflow

1. Install Node 24 + enable pnpm (Corepack or `npm i -g pnpm`)
2. `pnpm install`
3. `cp .env.example .env`
4. `pnpm dev:infra`
5. `pnpm db:migrate` && `pnpm db:seed`
6. `pnpm dev`

## Testing strategy

Config unit tests, API health inject tests, Compose DB integration, queue payload schema tests, Prisma migration smoke, web router smoke. Default `PROVIDER_MODE=fixture`.

## Parallel file ownership

Per WAVE-EXECUTION-PLAN Agents 1–9. Contract changes only via `doc/contracts/change-requests/`.

## Risks and assumptions

- Node 24 recommended; Node 22 may work for local smoke
- Windows + Docker Desktop for Compose
- Prisma 6.x over 7
- No real provider HTTP; production CI/CD deferred to Agent 8

## Explicitly out of scope

Real provider clients; final scoring; production deploy; payments; scraping; microservices.
