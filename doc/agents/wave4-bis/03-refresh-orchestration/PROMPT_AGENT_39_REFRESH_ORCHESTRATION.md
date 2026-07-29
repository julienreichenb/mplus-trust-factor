# Agent 39 Prompt — Automatic Refresh Orchestration and Cohort Strategy

You are responsible for designing and implementing sustainable automatic score refreshes.

Work on:

- branch: `agent/wave4.3-refresh-orchestration`
- base: `integration/wave4.3`

Persistence hardening through `c47c339` is part of the baseline.

Shared Survival/Utility WCL ingestion may still be in progress. Begin with audit, simulation and scheduling architecture. Do not activate expensive recurring refreshes before shared-ingestion compatibility is available.

## Objective

Create a configurable refresh system that keeps high-value profiles fresh, respects provider limits, prioritizes persisted evidence, avoids refreshing the full population blindly, supports several cadences and never removes the last published score when providers fail.

“Top 25%” is indicative, not hardcoded.

## Phase 1 — Audit

Inspect ingestion jobs, queue dedupe, refresh phases, freshness, WCL budget manager, provider costs, retry/defer logic, published freshness, rating/activity data, profile-view data, scheduling, worker concurrency, region distribution, cohort selector and retention.

Document implemented behavior versus scaffolding.

## Phase 2 — Measure actual cost

Build durable accounting per provider, operation, character, run, dataset, refresh reason, cache hit/miss, job, model-only recalculation and provider refetch.

For WCL track requests, points, pages, datasets, selected runs, persistence reuse, shared consumers and reset time.

Measure:

- cold new-character refresh;
- warm refresh;
- stale rankings-only refresh;
- detailed-event backfill;
- model-only recalculation;
- partial completion.

Do not choose cadence before costs are measured.

## Phase 3 — Cohort feasibility

Evaluate:

- `RATING_THRESHOLD`
- `TRACKED_PERCENTILE`
- `TOP_N_REGION`
- `TOP_N_SPEC_ROLE`
- `RECENTLY_VIEWED`
- `RECENTLY_ACTIVE`
- `PUBLISHED_AND_STALE`
- `MANUAL_PRIORITY`
- `DAILY_ELITE_COHORT`

For each document denominator, source, cost, bias, regional coverage, feasibility without a full population scan, complexity and abuse risk.

Do not claim global top 25% without an authoritative denominator.

Recommended first denominator: tracked characters with a current-season rating and a published score.

## Phase 4 — Adaptive cadence

Design configurable tiers:

- Tier A: elite, active, high demand — candidate daily;
- Tier B: strong and active — candidate every 3 days;
- Tier C: other active tracked profiles — candidate weekly;
- Tier D: inactive/low priority — on demand.

These are hypotheses. Validate them against measured cost and population.

Implement policy as configuration, not hardcoded conditions.

## Phase 5 — Scheduler architecture

Requirements:

- persistent schedules/checkpoints;
- deterministic job IDs;
- idempotent enqueue;
- duplicate coalescing;
- batch planning and size;
- region/spec fairness;
- global/provider concurrency;
- WCL safety reserve;
- one preflight per batch;
- defer/resume after reset;
- circuit breaker;
- per-character cooldown;
- stale-lock recovery;
- skip already-fresh datasets;
- never delete the current score when a job begins.

Use PostgreSQL for durable state. Redis may accelerate but is not required for correctness.

## Phase 6 — Dataset-aware planning

Examples:

- rating stale, combat evidence fresh: refresh rating only;
- model changed, observations compatible: local recalculation only;
- one report revision changed: refresh affected report only;
- profile stale, immutable history valid: reuse history;
- WCL unavailable: keep published score and defer missing datasets.

Integrate with shared WCL evidence bundles when available.

## Phase 7 — On-demand and authenticated behavior

Support public on-demand refresh, owner refresh, admin force recalculation, admin provider refetch and scheduled refresh with distinct semantics.

Admin/premium status must not bypass global provider safety.

## Phase 8 — Dry-run mode

Implement a planner that selects a cohort, estimates jobs, WCL points, completion time and regional/spec distribution while making zero provider calls and no score changes.

Use dry runs to recommend daily, three-day or weekly cadence.

## Phase 9 — Observability

Expose cohort size, jobs selected/skipped/deferred, next reset, planned/consumed WCL points, average cost, cache reuse, cohort duration, stale profiles by tier, scheduling lag and failures.

## Required tests

1. Cohort selection is deterministic.
2. No global percentile without a denominator.
3. Fresh profiles are skipped.
4. Model-only recalculation uses zero providers.
5. Duplicate jobs coalesce.
6. Batch stops before safety reserve.
7. Deferred jobs resume after reset.
8. Scheduler restart resumes checkpoint.
9. Fairness prevents one group consuming the budget.
10. Public score remains visible.
11. Provider failure does not create UNRANKED.
12. Dry-run has zero provider calls/writes.
13. Admin bypass does not bypass global WCL safety.
14. Build and tests pass.

## Live validation

Do not activate a recurring production schedule.

Run dry-run daily, three-day and weekly cohorts; one small cached batch; and one simulated low-quota batch.

## Deliverables

Return the audit, provider-cost measurements, feasibility matrix, denominator recommendation, cadence recommendation, scheduler architecture, dry-run reports, budget/fairness strategy, configuration, observability, migrations, tests, files changed and commit hash.

Do not hardcode top 25%.
Do not activate recurring production refreshes.
Do not change scoring curves or weights.
