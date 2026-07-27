# OpenAPI

## Generation

```bash
pnpm openapi:generate
```

Writes `apps/api/openapi.json` (gitignored). Live UI while API runs: `GET /docs`.

Generation uses `createApiContainer(env, { skipQueues: true })` so Redis is not required.

## Coverage

Every public and admin route registers Fastify JSON Schema for request params/query/body and response status codes. Swagger is registered via `@fastify/swagger` + `@fastify/swagger-ui`.

## Example response shapes (conceptual)

**Fresh profile (200):** `refreshStatus: "FRESH"`, non-null `score`, sources present.

**Stale profile (200):** `refreshStatus: "STALE"`, score returned, background refresh enqueued (deduped).

**Queued / no score (202):** `refreshStatus: "QUEUED"`, `score: null`, job may be present.

**No logs / insufficient data:** score may exist with reduced `confidence`, red flags such as `logs_hidden` / `insufficient_data` when workers soft-skip WCL or providers are disabled.

**Errors:** see [error-model.md](./error-model.md).
