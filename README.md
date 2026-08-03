# M+ Trust Factor

Explainable, versioned Mythic+ Trust Factor from public game data (Retail, region-aware; MVP = EU).

## Prerequisites

- Node.js **24** Active LTS (Node 22+ may work for local smoke; `.nvmrc` pins 24)
- [pnpm](https://pnpm.io/) 10 (`corepack enable` or `npm install -g pnpm`)
- Docker Desktop (PostgreSQL + Redis)

## Quick start

```bash
pnpm bootstrap
pnpm dev
```

`pnpm bootstrap` prepares a fresh clone/worktree (worktree-aware `.env` setup, live local-dev defaults, install, local infra, Prisma generate, package `dist` builds, migrate, seed). It does not start the app. Details: [`doc/operations/local-development.md`](doc/operations/local-development.md).

Linked worktrees do not inherit the primary `.env`. To copy it (or fill empty keys such as Battle.net credentials) non-interactively:

```bash
pnpm bootstrap -- --copy-env
```

PostgreSQL is published on host port **5433** (see `.env.example`) to avoid clashing with a local Postgres on 5432.

- API: http://localhost:3000 (`/health/live`, `/health/ready`, `/api/v1/meta`, `/docs`)
- Web: http://localhost:5173

## Scripts

| Command | Purpose |
|---------|---------|
| `pnpm bootstrap` | Prepare local worktree for `pnpm dev` |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | Strict TypeScript across packages |
| `pnpm test` | Unit tests (fixture mode) |
| `pnpm test:integration` | DB integration tests (Compose required) |
| `pnpm build` | Build all packages/apps |
| `pnpm openapi:generate` | Write `apps/api/openapi.json` |

## Documentation

**Start here:** [`AGENTS.md`](AGENTS.md) → [`doc/README.md`](doc/README.md).

Key product docs:

- [`doc/product/product-scope.md`](doc/product/product-scope.md)
- [`doc/product/scoring-model-v6.md`](doc/product/scoring-model-v6.md)
- [`doc/architecture/system-overview.md`](doc/architecture/system-overview.md)
- [`doc/operations/local-development.md`](doc/operations/local-development.md)

Front-end brand/UX: [`doc/architecture/frontend/`](doc/architecture/frontend/).

## Agent ownership

See [`doc/agents/file-ownership-map.md`](doc/agents/file-ownership-map.md).
