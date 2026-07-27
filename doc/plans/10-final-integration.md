# Agent 10 — Final Integration Plan

## Scope

Reconcile Agents 0–6 deliverables into a working fixture-mode MVP: wire real scoring, Blizzard provider DI, API ↔ frontend live mode, addon export, infra/CI, and release artifacts. Do **not** re-run Agents 1–9.

## Merge / conflict audit

| Component | Owner | Status | Tests | Contract gaps | Blocker | Integration action |
|-----------|-------|--------|-------|---------------|---------|-------------------|
| Foundation (monorepo, Prisma, queues) | 00 | Merged | 9+3 todo | — | — | Baseline OK |
| Blizzard provider package | 01 | Merged | 22 | CR-01 applied | Worker ignores package | Wire via provider factory + fixture fallback |
| WCL provider package | 02 | Stub | — | — | `notImplemented` | Keep worker fixture adapters |
| Raider.IO provider package | 03 | Stub | — | Legal review pending | `notImplemented` | Keep worker fixture adapters |
| Scoring engine | 04 | Merged | 15+4 mech | CR-04 proposed | Metrics upstream thin | Already wired in worker; enrich observations |
| Backend API + worker DAG | 05 | Merged | 39+5 pipeline | CR-05 applied | redFlags empty in mapper | Persist/extract redFlags; profile enrichment |
| Vue frontend | 06 | Merged | 26+5 e2e mock | CR-06 open | live-client path mismatch | Fix live client + enrichment DTOs |
| Addon export | 07 | Stub | — | — | CLI `not_implemented` | Implement Lua shard generator |
| CI/CD | 08 | Missing | — | — | No workflows | Add GitHub Actions CI |
| QA / observability | 09 | Partial | — | — | No release docs | Create `doc/release/*` |

## Contract change requests

| CR | Decision |
|----|----------|
| 01-blizzard-provider-surface | Applied — wire package in worker DI |
| 04-score-model-config-v1 | Keep rich config in `@mplus/scoring`; slim contract unchanged |
| 05-api-error-retryable | Applied |
| 05-public-details-all | Applied — gate premium fields when `false` |
| 06-profile-enrichment | **Apply** — extend `CharacterProfileResponse` additively |
| 06-realms-autocomplete | **Apply** — accept `q` alias for `query` |
| 06-admin-model-ops | **Apply** — add clone + PUT update routes |

## Migration review

- Single migration `20260727000000_init` — no conflicts.
- Fresh DB: `pnpm db:migrate` + `pnpm db:seed` idempotent.
- No new migrations required for integration.

## End-to-end dependency graph

```text
Search (web) → GET /characters/search
  → CharacterService.findOrCreate
  → enqueue refresh-character (BullMQ or inline in test)

Worker refresh DAG:
  resolve-character
    → Blizzard provider (fixture/live via factory)
    → Raider.IO fixture
    → WCL fixture (discover runs)
    → match LATEST/HIGHEST runs
    → analyze-run (WCL details)
    → extract-metrics
    → calculateScore (@mplus/scoring)
    → save ScoreSnapshot + dimensions

API profile:
  GET /characters/:region/:realm/:name (SWR)
    → mapCharacterProfile + enrichments (class, runs, equipment)

Compare:
  POST /comparisons

Addon:
  generate-addon-export job → Lua shards → MPlusTrustDB lookup

Web live mode:
  VITE_API_MODE=live → fixed live-client paths
```

## Acceptance matrix

| Criterion | Target |
|-----------|--------|
| `pnpm lint` | pass |
| `pnpm typecheck` | pass |
| `pnpm test` | pass (no regressions) |
| `pnpm test:integration` | pass |
| `pnpm test:e2e` | pass (mock) |
| `pnpm build` | pass |
| `pnpm openapi:generate` | writes `apps/api/openapi.json` |
| Fixture refresh → score persisted | worker + API tests |
| Web profile/compare (mock) | Playwright 5/5 |
| Web profile (live, fixture stack) | manual / integration note |
| Admin validate/backtest/activate/clone | API tests |
| Addon Lua lookup | exporter unit test |
| Docker infra health | `pnpm dev:infra` postgres+redis |
| CI workflow | lint+typecheck+test on push |

## Fixture cohort (deterministic personas)

Worker fixture providers use seeded data for arbitrary names. Named personas for demo/docs:

| Persona | Identity | Role |
|---------|----------|------|
| Strong non-meta DPS | EU/tarren-mill/Aleria | mage/fire DPS (web mock) |
| Weak meta high rating | EU/kazzak/Carryme | boost-suspect (web mock) |
| Sparse / hidden logs | EU/silvermoon/Lowdata | low confidence |
| Tank / healer | any name → seeded CLASS_SPECS | warrior/prot, priest/holy |

Full fixture flow: search → refresh job → DB score → API profile → compare → addon export.

## Live smoke strategy

Only when `PROVIDER_MODE=live` and credentials set:

1. One Blizzard EU character (`pnpm --filter @mplus/provider-blizzard smoke:live`)
2. Bounded WCL/RIO smoke deferred (packages stub)
3. Record request counts; no secrets in logs

Default: `PROVIDER_MODE=fixture` — no network.

## Release blockers

1. Raider.IO commercial-use review required before public launch
2. Boost/red-flag dispute mechanism not built (documented limitation)
3. WCL/RIO live packages incomplete — fixture-only for MVP

## Implementation sequence

1. Provider factory (`PROVIDER_MODE` + Blizzard package + worker fallback)
2. redFlags persistence in score snapshots
3. Profile enrichment (contracts + API + mappers)
4. Live API client path fixes
5. Admin clone/update routes
6. Addon Lua exporter
7. Root scripts: `.env` via `with-env.mjs`, compose aliases
8. CI workflow + release docs
9. Acceptance run + handoff commit
