# Agent 39 Handoff — Refresh Orchestration

## Commit

`7c6e03d` — feat(refresh): add orchestration planner, cost ledger, and dry-run scheduler

## Summary

Configurable refresh orchestration: cohort strategies with explicit denominators, adaptive cadence tiers (config), dataset-aware planning, checkpointed dry-run scheduler, durable cost ledger schema, fairness caps, and observability snapshots.

**Recurring production refreshes are not activated.**

## Configuration (defaults)

| Env | Default | Meaning |
|-----|---------|---------|
| `REFRESH_SCHEDULER_ENABLED` | `false` | Live enqueue gate |
| `REFRESH_DRY_RUN_ONLY` | `true` | Force dry-run semantics |
| `REFRESH_SAFETY_RESERVE_FRACTION` | `0.1` | WCL reserve |
| `REFRESH_BATCH_SIZE` | `50` | Plan batch size |
| `REFRESH_GLOBAL_CONCURRENCY` | `2` | Intended worker concurrency knob |
| `REFRESH_PER_CHARACTER_COOLDOWN_SECONDS` | `3600` | Scheduler cooldown |
| `REFRESH_SPREAD_HOURS` | `24` | Spread hint |
| `REFRESH_TRACKED_TOP_PERCENT` | `25` | Indicative within declared denominator |
| `REFRESH_RATING_THRESHOLD` | `2500` | Elite rating floor |

## Migration

`packages/database/prisma/migrations/20260729160000_refresh_orchestration`

## Key modules

- `packages/config/src/refresh-policy.ts`
- `apps/worker/src/orchestration/cohort-selector.ts`
- `apps/worker/src/orchestration/cohort-fairness.ts`
- `apps/worker/src/orchestration/dataset-refresh-planner.ts`
- `apps/worker/src/orchestration/refresh-scheduler.ts`
- `apps/worker/src/orchestration/refresh-cost-ledger.ts`
- `apps/worker/src/orchestration/refresh-observability.ts`
- `apps/worker/src/orchestration/wcl-budget-manager.ts`

## Docs

- `AUDIT.md`, `FEASIBILITY_MATRIX.md`, `SCHEDULER_ARCHITECTURE.md`, `COST_MEASUREMENTS.md`, `REFRESH_POLICY_BRIEF.md`

## Tests

- `cohort-selector.test.ts`
- `dataset-refresh-planner.test.ts`
- `refresh-orchestration.test.ts` (requirements 1–13 + gates)
- Existing `wcl-budget-manager.test.ts`

## Live validation performed

Dry-run planner unit coverage for daily / three-day / weekly recommendations, cached/deferred budget batch simulation, and low-quota deferral. **No production recurring schedule enabled.**

## Do not

- Hardcode top 25% as a global WoW claim
- Enable recurring production refreshes without measured costs + shared-ingest readiness
- Change scoring curves or weights
