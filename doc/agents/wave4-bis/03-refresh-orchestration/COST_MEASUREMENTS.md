# Provider Cost Measurements (Phase 2)

Live cadence must not be chosen before costs are measured. Until a durable ledger is populated from production refreshes, use these **conservative baselines** (`BASELINE_COST_SCENARIOS` in `refresh-cost-ledger.ts`).

| Scenario | Provider calls | WCL points | Cache | Model-only | Notes |
|----------|----------------|------------|-------|------------|-------|
| Cold new-character | ~18 | ~85 | 0 hits | No | Full Blizzard + RIO + WCL discovery/events |
| Warm refresh | ~8 | ~35 | High reuse | No | Immutable combat reuse |
| Stale rankings-only | ~4 | ~12 | High | No | `RATING_ONLY` plan |
| Detailed-event backfill | ~12 | ~60 | Partial | No | Shared evidence / fight pages |
| Model-only recalculation | **0** | **0** | n/a | **Yes** | Persisted observations |
| Partial completion | ~6 | ~25 | Partial | No | Soft-skip; published preserved |

## Ledger dimensions

Each `refresh_cost_ledger_entries` row records:

- provider, operation, dataset
- character, run, job, schedule run
- refresh reason
- cache hit/miss
- estimated vs measured cost + `costSource` (`MEASURED` | `ESTIMATED` | `UNKNOWN`)
- `modelOnly` / `providerRefetch` flags

**Rule:** never coerce `UNKNOWN` measured cost to `0` (aligned with `wcl-batch-cost-accounting`).

## Cadence recommendation (pre-live)

Using warm-refresh ~35 pts/character and a typical WCL hourly budget:

- **Daily** only for small Tier A elite sets that fit &lt;25% of hourly headroom after reserve
- **Every 3 days** for Tier B when daily elite volume is too costly
- **Weekly** for remaining active tracked (Tier C)
- **On demand** for Tier D

Re-run dry-run planner after ledger calibration; do not enable `REFRESH_SCHEDULER_ENABLED` until shared-ingestion compatibility + measured costs are accepted.
