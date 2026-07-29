# Agent 39 — Refresh Orchestration Audit

**Branch:** `agent/wave4.3-refresh-orchestration`  
**Baseline:** `integration/wave4.3` (includes persistence hardening through `c47c339` and shared WCL evidence ingestion `a8240a0`)

## Verdict

| Area | Status |
|------|--------|
| On-demand refresh (API → BullMQ → pipeline → coherence publish) | **Implemented** |
| Job dedupe / stale QUEUED recovery | **Implemented** |
| WCL live STOP/DEFER in provider | **Implemented** |
| Publication gate (never wipe last published on failure) | **Implemented** |
| Cohort selector / WclBudgetManager / refresh phases | **Were scaffolding → now wired as planner architecture** |
| Dataset freshness helpers | **Config existed → planner consumes them** |
| Persistent schedules / checkpoints | **Added (PG)** — recurring production enqueue **disabled** |
| Dry-run planner | **Implemented** |
| Adaptive cadence tiers A–D | **Config-driven** |
| Durable cost ledger | **Schema + aggregation helpers** |
| Profile view instrumentation | **Table added; write path not yet hooked to GET profile** |
| Shared evidence in production refresh pipeline | **Partial** — store adapter exists; full shared-ingest consumers still landing |

## Implemented vs scaffolding (detail)

### Implemented (production path)
- `refresh-pipeline.ts`, `publication-flow.ts`, job enqueue/dedupe
- API: `GET` profile SWR enqueue, `POST /refresh`, admin recalculate
- WCL rate budget inside live provider
- Batch WCL cost accounting for evidence probes

### Architecture delivered by Agent 39 (safe defaults)
- `packages/config/src/refresh-policy.ts` — cadence tiers + env gates
- Expanded `cohort-selector.ts` + fairness + denominator enforcement
- `dataset-refresh-planner.ts` — dataset-aware modes
- `refresh-scheduler.ts` — checkpointed dry-run / cached / live (live gated off)
- `refresh-cost-ledger.ts` + Prisma `refresh_cost_ledger_entries`
- `refresh_schedule_runs` / `refresh_schedule_items` / `character_profile_views`
- Observability snapshot builder

### Explicitly not activated
- Recurring production cron / BullMQ repeatables
- `REFRESH_SCHEDULER_ENABLED` default `false`
- `REFRESH_DRY_RUN_ONLY` default `true`

## Denominator recommendation

**Use:** tracked characters with a current-season Mythic+ rating **and** a published score  
(`tracked_published_current_season_rating`)

Do **not** claim global top 25% of WoW. `REFRESH_TRACKED_TOP_PERCENT` is indicative within that denominator only.
