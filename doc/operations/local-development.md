# Local development

## Requirements

- Node.js 24 (see `.nvmrc`); Node 22+ may work for smoke tests
- pnpm 10 (`packageManager` field; prefer Corepack)
- Docker Desktop for PostgreSQL 16 and Redis 7

## Boot

```bash
pnpm install
cp .env.example .env
pnpm dev:infra
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
```

PostgreSQL listens on host port **5433** by default (mapped from container 5432) so it does not collide with a local Windows Postgres install.

Stop infra: `pnpm dev:infra:down`.

## Fixture mode

`PROVIDER_MODE=fixture` is the default for automated tests. Live provider credentials are not required for lint/typecheck/unit tests.

## Useful URLs

- API live: `GET http://localhost:3000/health/live`
- API ready: `GET http://localhost:3000/health/ready`
- Meta: `GET http://localhost:3000/api/v1/meta`
- OpenAPI UI: `http://localhost:3000/docs`
- Web: `http://localhost:5173`
