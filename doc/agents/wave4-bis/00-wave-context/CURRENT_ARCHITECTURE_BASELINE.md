# Current Architecture Baseline

## Scoring

| Dimension | Weight | Status |
|---|---:|---|
| Performance | 35% | Production |
| Survival | 30% | Production |
| Utility | 25% | Experimental, not production-ready |
| Experience | 10% | Production but scheduled for rework |

Confidence and Authenticity are separate signals.

## Persistence

The persistence hardening work introduced:

- immutable score candidates;
- coherence validation;
- published snapshot pointers;
- last-known-good behavior;
- deterministic observation upserts;
- dataset-specific freshness;
- WCL budget-management primitives;
- refresh phases and rejection diagnostics.

Important entities include:

- `score_snapshots`
- `character_published_scores`
- `metric_observations`
- `ingestion_jobs`
- `external_requests`
- `external_payloads`
- `run_analyses`

## Public reads

The public character endpoint must read from PostgreSQL, return the current published snapshot, expose freshness and refresh state, and never synchronously fetch Blizzard, Raider.IO or WCL.

## Refresh behavior

A refresh must keep the current published score visible, coalesce duplicates, reuse compatible data, reject incomplete candidates, defer when quota is insufficient and publish atomically only after coherence validation.

## Utility status

Utility V3, V3.1 and V3.2 remain offline experiments.

The latest audit proved:

- persisted cast artifacts contain friendly-player casts only;
- hostile NPC cast starts/completions are missing;
- confirmed interrupt misses cannot currently be derived;
- no further curve tuning should occur before shared hostile-cast ingestion exists.

Agent 35 owns the shared Survival/Utility WCL evidence-ingestion continuation.
