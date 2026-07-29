# Scheduler Architecture

## Goals

Keep high-value profiles fresh, respect provider limits, prioritize persisted evidence, avoid full-population blind refresh, support multiple cadences, **never remove the last published score** when providers fail.

## Durable state (PostgreSQL)

| Table | Role |
|-------|------|
| `refresh_schedule_runs` | Plan/run metadata, checkpoint JSON, distributions, resume time |
| `refresh_schedule_items` | Per-character plan rows, deterministic job keys, deferral |
| `refresh_cost_ledger_entries` | Per provider/operation/character/run cost accounting |
| `character_profile_views` | Demand signal for `RECENTLY_VIEWED` |

Redis may accelerate queues but is **not** required for scheduler correctness.

## Safety gates

1. `REFRESH_SCHEDULER_ENABLED=false` (default) — no recurring live enqueue
2. `REFRESH_DRY_RUN_ONLY=true` (default) — planner cannot mutate scores / call providers
3. `WclBudgetManager.preflight` — stop before safety reserve; admin cannot bypass
4. Per-character cooldown (`REFRESH_PER_CHARACTER_COOLDOWN_SECONDS`)
5. Region/spec fairness caps
6. Dataset planner always sets `preservePublishedScore: true`

## Planning flow

```text
load tracked candidates
  → selectCohort(strategy, denominator)
  → assignCadenceTier (config)
  → skip fresh / cooldown
  → applyFairnessCaps
  → planDatasetRefresh (per character)
  → WclBudgetManager.preflight (batch cumulative)
  → checkpoint + observability snapshot
  → DRY_RUN: stop (zero provider / zero score writes)
  → LIVE_ENQUEUE: only if both gates enabled
```

## Deterministic job keys

`buildScheduledRefreshJobKey(characterId, cadenceTier, strategy, datasets)` — SHA-256, order-independent datasets. Duplicates coalesce via `coalesceDuplicateJobKeys` and existing `IngestionJob.dedupeKey` on enqueue.

## Defer / resume

Items marked `DEFERRED_RATE_LIMIT` store `deferredUntil = resetAt`.  
`resumeDeferredAfterReset` flips them to `PLANNED` after reset. Checkpoint cursor allows process restart without redoing completed work.

## Cadence (config hypotheses)

| Tier | Intent | Default interval |
|------|--------|------------------|
| A | Elite + active | 24h |
| B | Strong + active | 72h |
| C | Other active tracked | 168h |
| D | Inactive / low priority | on demand |

Validate against measured ledger costs before enabling live schedules.

## Dataset-aware modes

- Rating stale / combat fresh → `RATING_ONLY`
- Model changed / observations compatible → `MODEL_ONLY_RECALCULATION` (0 providers)
- Report revision changed → `PARTIAL_REPORT_REFRESH`
- Immutable history valid → `REUSE_HISTORY`
- WCL down → `DEFER_MISSING_DATASETS` (keep published)

## On-demand semantics

| Reason | Cooldown bypass | Provider refetch | Global WCL safety |
|--------|-----------------|------------------|-------------------|
| `public_on_demand` | No | No | Always |
| `owner_refresh` | No | No | Always |
| `admin_force_recalculation` | Yes | No (model-only preferred) | Always |
| `admin_provider_refetch` | Yes | Yes | Always |
| `scheduled_refresh` | No | No | Always |
| `dry_run` | Yes | No | Always (no calls) |
