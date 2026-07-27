# M+ Trust Factor

Explainable, versioned Mythic+ Trust Factor from public game data (Retail, region-aware; MVP = EU).

## Prerequisites

- Node.js **24** Active LTS (Node 22+ may work for local smoke; `.nvmrc` pins 24)
- [pnpm](https://pnpm.io/) 10 (`corepack enable` or `npm install -g pnpm`)
- Docker Desktop (PostgreSQL + Redis)

## Quick start

```bash
pnpm install
cp .env.example .env
pnpm dev:infra
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
```

PostgreSQL is published on host port **5433** (see `.env.example`) to avoid clashing with a local Postgres on 5432.

- API: http://localhost:3000 (`/health/live`, `/health/ready`, `/api/v1/meta`, `/docs`)
- Web: http://localhost:5173

## Scripts

| Command | Purpose |
|---------|---------|
| `pnpm lint` | ESLint |
| `pnpm typecheck` | Strict TypeScript across packages |
| `pnpm test` | Unit tests (fixture mode) |
| `pnpm test:integration` | DB integration tests (Compose required) |
| `pnpm build` | Build all packages/apps |
| `pnpm openapi:generate` | Write `apps/api/openapi.json` |

## Documentation

See `doc/` — start with `doc/operations/local-development.md` and `doc/plans/00-foundation.md`.

## Agent ownership

Parallel agents must stay inside paths declared in `doc/architecture/parallel-ownership.md`.
