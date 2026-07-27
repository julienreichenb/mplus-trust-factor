# Internal API routes

Owned by Agent 5. OpenAPI UI: `/docs`. Generated artifact: `pnpm openapi:generate` → `apps/api/openapi.json`.

## Health

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/health/live` | — | Liveness |
| GET | `/health/ready` | — | DB readiness |

## Public v1

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/api/v1/meta` | — | App version, provider mode, active model |
| GET | `/api/v1/realms` | — | `region`, `query` |
| GET | `/api/v1/characters/search` | — | `region`, `realm`, `name` |
| GET | `/api/v1/characters/:region/:realm/:name` | — | SWR profile (200 / 202 / 404) |
| POST | `/api/v1/characters/:region/:realm/:name/refresh` | — | Manual refresh; cooldown + dedupe |
| GET | `/api/v1/characters/:region/:realm/:name/refresh-status` | — | Job + cooldown |
| GET | `/api/v1/characters/:region/:realm/:name/history` | — | Score snapshot history |
| GET | `/api/v1/characters/:region/:realm/:name/runs` | — | `kind=latest\|highest` |
| GET | `/api/v1/characters/:region/:realm/:name/scores` | — | Latest score DTO |
| POST | `/api/v1/comparisons` | — | Body: 2–10 identities |
| GET | `/api/v1/score-models/public` | — | Active models |
| GET | `/api/v1/jobs/:id` | — | Ingestion job status |

## Admin (MVP)

Header: `x-admin-api-key: <ADMIN_API_KEY>`

| Method | Path | Notes |
|--------|------|-------|
| GET/POST | `/api/v1/admin/score-models` | List / create draft |
| POST | `/api/v1/admin/score-models/:id/validate` | Config validation |
| POST | `/api/v1/admin/score-models/:id/backtest` | Fixture cohort stub |
| POST | `/api/v1/admin/score-models/:id/activate` | Activate + archive previous |
| POST | `/api/v1/admin/characters/:id/recalculate` | Enqueue recalculate |
| GET/POST | `/api/v1/admin/mechanic-rules` | List / create |
| GET/PATCH/DELETE | `/api/v1/admin/mechanic-rules/:id` | Read / update / deactivate |

## Rate limiting

`@fastify/rate-limit` global: 120/min (10_000/min in `NODE_ENV=test`). Refresh and search share the global budget.

## Correlation

Clients may send `x-request-id`; responses and error envelopes echo `requestId`.
