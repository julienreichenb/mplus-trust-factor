# Load tests

## Tool

[autocannon](https://github.com/mcollina/autocannon) via `tools/scripts/load-test.mjs`.

## Targets (provisional MVP)

| Endpoint | p95 target (local) |
|----------|-------------------|
| `GET /health/live` | < 300 ms |
| `GET /api/v1/meta` | < 300 ms |

Compare and profile targets apply once Agent 5 routes exist.

## Run locally

```bash
pnpm dev:infra
pnpm db:migrate && pnpm db:seed
pnpm --filter @mplus/api dev   # separate terminal
pnpm test:load
# optional: pnpm test:load -- --url http://localhost:3000 --duration 15
```

Uses fixture/cached endpoints only — no external API calls.

## Exporter budget

Addon exporter 100k synthetic character budget is documented for Agent 7; load script does not cover exporter yet.

## CI

Load test is optional in CI (requires running API). Unit/contract tests gate PRs.
