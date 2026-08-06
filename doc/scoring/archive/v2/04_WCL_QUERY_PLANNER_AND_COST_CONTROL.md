---
status: proposed
normative: true
last_reviewed: 2026-08-01
repository: julienreichenb/mplus-trust-factor
baseline_main: 0b0d911f9c4f3ec771bd8f2390e972da01595f99
calibration_draft_branch: agent/11-scoring-calibration-study
calibration_draft_head_observed: 5603d4b8f01375599fa0bb71255b98d775cd8e4d
---


# WCL query planner and cost control

## 1. Objectives

The planner must minimize WCL points and latency while guaranteeing that evidence quality is not determined by request order or budget exhaustion.

It performs four independent functions:

1. discover low-cost candidate/profile data;
2. select metadata candidates;
3. plan the exact union of detailed datasets;
4. reserve, execute, and account for WCL work.

## 2. Staged query plan

### Stage A — profile/discovery

Run concurrently after Blizzard identity succeeds:

- WCL character resolve/summary;
- `points_and_damage`;
- zone rankings/parse candidates;
- bounded recent report pagination;
- Blizzard current/prior season requests;
- optional Raider.IO history.

No detailed events are fetched here.

### Stage B — metadata hydration

Group candidates by report code. Fetch report metadata, selected fight IDs, revision, master data, and actors in as few calls as supported.

Metadata hydration is lazy:

- hydrate best-ranked candidates first;
- continue only until two valid metadata candidates per dungeon are secured;
- retain fallback metadata only within configured bounds.

### Stage C — detailed evidence plan

For each selected run, compute the union of datasets needed by enabled consumers.

#### Phase 1 consumer matrix

| Dataset | Performance | Survival | Utility |
|---|---:|---:|---:|
| Ranking/parse | required | no | no |
| masterData | optional | required | required |
| Casts | no | required | required |
| HostileCasts | no | optional | required |
| Interrupts | no | no | required |
| Deaths | no | required | optional |
| DamageTaken | no | required | no |
| Buffs | no | required | required |
| Debuffs | no | optional | required |
| Dispels | no | no | required |
| Healing | no | required | no |
| CombatantInfo | no | required | required |
| DamageDone | no | shadow aggregate only | no |

The planner fetches each compatibility-key dataset once even when multiple consumers require it.

### Stage D — execution

Execute with:

- per-refresh bounded concurrency;
- global WCL weighted token bucket;
- rate-budget reservation;
- pagination checkpoints;
- idempotent cache/artifact writes;
- cancellation checks.

Initial per-refresh detailed-call concurrency: 3. Raise only after load and rate-cost evidence.

## 3. Compatibility key

Dataset cache identity:

```text
reportCode
reportRevision
fightId
actorId or all
dataset
startTime
endTime
filterExpression
hostilityType
includeResources
providerContractVersion
```

The current shared-evidence key should be extended to include any missing semantic parameters, especially `includeResources` and hostility.

## 4. Batching

### Safe batching

- multiple selected fight IDs from the same report for metadata;
- table queries covering multiple fights when semantics are unchanged;
- static master data once per report revision.

### Conditional batching

Event queries may accept multiple fight IDs, but batching must not lose per-run attribution, pagination boundaries, or actor filters. Use only when:

- same data type;
- same filter;
- same source/target scope;
- response can be deterministically partitioned;
- request cost is lower than separate calls.

### Do not batch

- different report revisions;
- different source actors when player attribution matters;
- resource-heavy health snapshots with unrelated fights;
- datasets with different filter expressions.

## 5. Rate-budget admission

Before detailed fan-out:

```ts
estimatedPlanCost =
  sum(cacheMissDatasetEstimatedCosts)
  + safetyMargin
```

Required states:

- `ADMIT`: budget comfortably sufficient;
- `WARN`: admit but emit utilization warning;
- `DEFER`: schedule after reset;
- `STOP`: fail closed due invalid/missing rate snapshot or unsafe utilization.

Reservation rules:

- one reservation per refresh/evidence plan;
- reservation released or settled idempotently;
- measured cost replaces estimated hold;
- unknown measured cost remains unknown and is reported;
- no double subtraction from provider snapshot;
- all selected-run work shares the same admission session.

## 6. Partial completion semantics

A technical failure may leave persisted artifacts, but publication is atomic:

- successfully fetched datasets remain reusable;
- the analysis batch records terminal status per slot;
- a new public V2 score is not finalized until publication gates pass;
- retry resumes missing compatibility keys only;
- budget exhaustion mid-run defers remaining work and prevents partial score publication.

## 7. Pagination

For every page store:

- page index;
- start cursor/time;
- next page timestamp;
- event count;
- payload hash;
- WCL request cost;
- truncated/limit state.

Guard against:

- non-advancing cursor;
- repeated page hash;
- event/page hard limits;
- timestamps outside fight range;
- excessive event counts;
- cancellation.

Truncation makes the affected dataset invalid unless the consumer explicitly supports partial semantics.

## 8. Aggregate tables versus events

Use WCL tables for volume-only metrics when verified:

- group DamageTaken totals;
- total Casts;
- Interrupts summary;
- Healing totals;
- Survivability summaries.

Use events for:

- low-health windows;
- defensive timing;
- cooldown availability;
- interruption attempts and overlap;
- external mitigation timing;
- pet/player attribution where tables are insufficient.

Every table-based metric requires a probe proving parity with event-derived fixtures.

## 9. Cache tiers

1. **Process cache**: token, report revision, short-lived metadata.
2. **Redis cache**: cross-worker metadata and negative cache.
3. **PostgreSQL metadata**: request records, hashes, fact-set metadata.
4. **Artifact storage**: compressed raw event/table pages.
5. **Normalized facts**: durable, versioned, compact analysis inputs.

Do not store large event arrays directly in frequently updated JSONB rows.

## 10. TTL policy

| Data | TTL |
|---|---|
| WCL token | token expiry minus safety margin |
| current character summary | configured short TTL |
| current zone rankings | short/medium TTL; partition-aware |
| frozen zone metadata/rankings | permanent after verification |
| report metadata | revision-aware long TTL |
| report event artifact | immutable by report revision and payload hash |
| negative archived/gated candidate | bounded TTL |
| schema unsupported | short TTL plus alert, not aggressive retry |

## 11. Cost observability

Record per refresh:

- planned datasets;
- cache/persisted hits;
- provider calls;
- pages;
- measured and estimated points;
- admission state;
- deferred duration;
- duplicate logical fetches;
- cost per dimension and per selected run;
- bytes fetched and artifact compression ratio.

## 12. Required failure tests

- stale/missing rate snapshot;
- reservation conflict;
- budget depleted between plan and execution;
- repeated pagination cursor;
- WCL schema drift;
- one report with multiple selected fights;
- cache hit after worker restart;
- cancellation during page fetch;
- retry reuses completed pages;
- no partial publication;
- same dataset requested by Survival and Utility only once.
