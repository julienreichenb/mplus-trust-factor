# Testing strategy

## Pyramid

| Layer | Tooling | CI |
|-------|---------|-----|
| Unit | Vitest | Always |
| Contract | Vitest + `@mplus/test-utils` + OpenAPI | Always — drift fails build |
| Data quality | Vitest invariant helpers | Always |
| Integration | Vitest + Docker Postgres/Redis | When infra available |
| Failure injection | Vitest mocks | Always |
| Load | autocannon (`pnpm test:load`) | Local / optional |
| E2E | Playwright | Agent 10 |

## Commands

```bash
pnpm test                  # all unit + contract + security + failure tests
pnpm test:contract         # provider fixtures + OpenAPI
pnpm test:data-quality     # invariant checks
pnpm test:security         # redaction + SSRF
pnpm test:failure          # provider/infra failure injection
pnpm test:integration      # Postgres (requires pnpm dev:infra)
pnpm test:load             # local API load (requires running API)
pnpm openapi:generate      # refresh apps/api/openapi.json
```

## Fixture mode

All automated tests set `PROVIDER_MODE=fixture`. No live provider credentials in CI.

## Ownership

- `@mplus/test-utils` — shared loaders, schemas, invariants (Agent 9)
- Provider fixture shapes — coordinated with Agents 1–3 via manifest
- Scoring golden tests — `tools/fixtures/scoring/expert-cohort-v1.json`
