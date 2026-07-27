# Warcraft Logs integration overview

Owned by Agent 2. Public GraphQL API via OAuth `client_credentials` at `https://www.warcraftlogs.com/api/v2/client`.

## Authentication

- Token: `POST https://www.warcraftlogs.com/oauth/token` (Basic auth, `grant_type=client_credentials`)
- Cached server-side with expiry safety margin
- User/private API (`/api/v2/user`) is **not** used in MVP

## Provider modes

| Mode | Env | Behavior |
|------|-----|----------|
| `fixture` | `PROVIDER_MODE=fixture` (default) | Sanitized JSON under `tools/fixtures/warcraftlogs/` |
| `live` | `PROVIDER_MODE=live` + `WCL_CLIENT_ID/SECRET` | Real GraphQL calls |

Factory: `createWarcraftLogsProvider(mode, env)` from `@mplus/provider-warcraftlogs`.

## Normalized outputs

Facts only — no Trust Factor scoring:

- `WclCharacterSummary`, `WclRankingObservation`, `WclRunCandidate`
- `WclReportSummary`, `WclFightSummary`, `RunCombatFacts`
- Run matching with confidence (`HIGH` / `MEDIUM` / `LOW` / `NONE`)

## Key operations

See [graphql-operations.md](./graphql-operations.md), [run-discovery-and-matching.md](./run-discovery-and-matching.md), [event-coverage.md](./event-coverage.md), [rate-budget.md](./rate-budget.md), [limitations.md](./limitations.md).

## Smoke test

```bash
pnpm build
node tools/scripts/wcl-smoke.mjs
```

Skips when credentials unavailable.

## Official docs

- https://www.warcraftlogs.com/api/docs
- https://www.warcraftlogs.com/v2-api-docs/warcraft/
