# Wave 2 Final Integration Plan

**Branch:** `integration/wave2`  
**Date:** 2026-07-27  
**Scope:** Agent 10 — connect Agents 0–9 without re-running provider agents.

## Merge audit

| Component | Owner | Wave 2 status | Integration action |
|-----------|-------|---------------|-------------------|
| Foundation / Prisma | Agent 0 | Merged | Reuse wave1 worker/API orchestration |
| Blizzard provider | Agent 1 | Package + wave1 composite | Keep composite fixture fallback |
| Warcraft Logs | Agent 2 | Package complete | Wire `createWarcraftLogsProvider` into worker DAG |
| Raider.IO | Agent 3 | Package complete | Wire `createRaiderIoProvider`; honour `RAIDERIO_ENABLED` |
| Scoring | Agent 4 | wave1 engine restored | Feed `RaiderIoBoostSupportFacts` into authenticity |
| Worker/API | Agent 5 | wave1 restored | Extend refresh pipeline for WCL combat facts |
| Frontend | Agent 6 | Stub pages | Out of scope — API fixture flow only |
| Addon | Agent 7 | Shard exporter | Worker job reads `ScoreSnapshot` → `runExport()` |
| CI/CD | Agent 8 | Partial | Verify root scripts pass |
| QA/Security | Agent 9 | Merged | `validateScoreSnapshot` at persistence; `/metrics` live |

## Contract change requests

| CR | Decision |
|----|----------|
| `02-warcraftlogs-extended-provider` | **Deferred** — worker imports `RunCombatFacts` from `@mplus/provider-warcraftlogs` |
| `03-raiderio-types` | **Reconciled** — types in `@mplus/contracts`; worker uses `extractBoostSupportFacts` |

## Dependency graph (fixture mode)

```
refresh-character job
  → Blizzard profile/equipment/M+ rating
  → Raider.IO profile + boost facts (if enabled)
  → WCL discover runs + provenance
  → upsert runs / select LATEST+HIGHEST
  → WCL getReportFightDetails → RunCombatFacts
  → metric extraction
  → scoring (authenticity from boost facts)
  → validateScoreSnapshot
  → persist ScoreSnapshot + ExternalPayload

generate-addon-export job
  → query ScoreSnapshots
  → buildExportResult → addon/MPlusTrust/Data/**
```

## Acceptance matrix

| Check | Target |
|-------|--------|
| `pnpm lint` | pass |
| `pnpm typecheck` | pass |
| `pnpm test` | pass (incl. worker provider integration) |
| `pnpm test:integration` | pass (Postgres) |
| `pnpm test:contract` | pass |
| `pnpm build` | pass |
| `pnpm addon:export` | fixture CLI still works |
| Refresh pipeline (Postgres) | persisted snapshot + WCL analysis + provenance |
| Addon export job | DB-sourced shards |

## Live-data limitations (documented, not exercised in CI)

- Blizzard live requires OAuth credentials; fixture composite covers tests.
- WCL live actor resolution uses default character env vars — worker must pass identity (follow-up).
- Raider.IO live season-cutoffs returned HTTP 500 during Agent 3 verification.
- Raider.IO commercial use requires explicit approval before launch.
- WCL extended DTOs remain in provider package until a coordinated contracts promotion.

## Rollback

Revert Agent 10 commit; set `PROVIDER_MODE=fixture` and `RAIDERIO_ENABLED=false` to minimise provider surface.
