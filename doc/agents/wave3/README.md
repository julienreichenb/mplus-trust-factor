# Wave 3 agent execution map

## Scope

Only deliver the live-data MVP:

`search exact character → refresh → persisted score → character details`

Preserve all existing fixture functionality. Do not expand compare/admin/addon features.

## Execution order

### Phase A — parallel

- Agent 11 — live foundation, secrets and developer workflow
- Agent 12 — Blizzard live hardening
- Agent 13 — Raider.IO live profile integration
- Agent 14 — Warcraft Logs public live hardening

Merge Phase A into `integration/wave3-providers` after each agent passes its owned tests.

### Phase B — after Phase A

- Agent 15 — source reconciliation, score inputs and refresh DAG

### Phase C — parallel after Agent 15

- Agent 16 — search/profile API and Vue UX
- Agent 17 — live QA, security, observability and runbooks

### Final

- Agent 20 — final integration, live smoke and handoff

## Ownership rules

- Agents 12–14 own only their provider package, provider fixtures/tests and provider research doc.
- Agent 11 owns config, environment loading, secret hygiene and root scripts.
- Agent 15 owns worker orchestration, shared contracts and scoring integration.
- Agent 16 owns `apps/api` and `apps/web` for the narrowed user flow.
- Agent 17 owns test harnesses, security checks, metrics/runbooks; avoid feature rewrites.
- Agent 20 may resolve integration conflicts but must not redesign the product.

## Common acceptance commands

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:contract
pnpm test:data-quality
pnpm test:security
pnpm test:failure
pnpm test:e2e
pnpm build
pnpm openapi:generate
```

Live smoke commands must never run automatically in CI.
