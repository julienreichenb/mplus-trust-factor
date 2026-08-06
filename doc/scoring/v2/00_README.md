---
status: proposed
normative: true
last_reviewed: 2026-08-01
repository: julienreichenb/mplus-trust-factor
baseline_main: 0b0d911f9c4f3ec771bd8f2390e972da01595f99
calibration_draft_branch: agent/11-scoring-calibration-study
calibration_draft_head_observed: 5603d4b8f01375599fa0bb71255b98d775cd8e4d
---


# M+ Trust Factor — Scoring V2 documentation set

This directory is the normative context for the redesign of data collection, evidence selection, scoring, calibration, publication, and progressive rollout.

## Why this redesign exists

The current system can calculate dimension scores from an evidence sample that is thinner than the public profile suggests. A Warcraft Logs profile may display a large run count while M+ Trust Factor has only analyzed one detailed log for some dungeons. A score is not trustworthy unless the exact evidence sample is explicit, reproducible, sufficiently broad, and shared across dimensions.

The target system therefore establishes these primary invariants:

1. **One immutable evidence selection per character, season, specialization/role scope, and refresh contract.**
2. **Two distinct public WCL runs per active dungeon whenever available.**
3. **The same selected runs feed Performance, Survival, and Utility.**
4. **Missing evidence reduces confidence or blocks publication; it never becomes a fabricated bad score.**
5. **Raw provider data, normalized facts, metrics, dimension aggregates, and public snapshots are separate layers.**
6. **No scoring or calibration replay performs external provider calls.**
7. **Every published result is reproducible from frozen inputs and versioned algorithms.**
8. **Population-relative features remain disabled or shadow-only until critical-mass gates are met.**

## Document map

| File | Purpose |
|---|---|
| [01_SCORING_PRINCIPLES_AND_GOVERNANCE.md](01_SCORING_PRINCIPLES_AND_GOVERNANCE.md) | Trust model, ownership, invariants, versioning |
| [02_EXTERNAL_DATA_SOURCES_AND_CONTRACTS.md](02_EXTERNAL_DATA_SOURCES_AND_CONTRACTS.md) | WCL, Blizzard, Raider.IO contracts and limitations |
| [03_WCL_EVIDENCE_SELECTION_CONTRACT.md](03_WCL_EVIDENCE_SELECTION_CONTRACT.md) | Deterministic 2×8 run selection and fallback |
| [04_WCL_QUERY_PLANNER_AND_COST_CONTROL.md](04_WCL_QUERY_PLANNER_AND_COST_CONTROL.md) | Query planning, caching, rate budget, batching |
| [05_PIPELINE_ORCHESTRATION_AND_PARALLELISM.md](05_PIPELINE_ORCHESTRATION_AND_PARALLELISM.md) | DAG, queues, idempotency, fan-out/fan-in |
| [06_DATA_MODEL_PERSISTENCE_RETENTION.md](06_DATA_MODEL_PERSISTENCE_RETENTION.md) | Target DB model, artifacts, retention, destructive migration |
| [07_PERFORMANCE_SCORING_SPEC.md](07_PERFORMANCE_SCORING_SPEC.md) | Performance Phase 1–3 model |
| [08_SURVIVAL_SCORING_SPEC.md](08_SURVIVAL_SCORING_SPEC.md) | Survival Phase 1–3 model |
| [09_UTILITY_SCORING_SPEC.md](09_UTILITY_SCORING_SPEC.md) | Utility Phase 1–3 model |
| [10_EXPERIENCE_SCORING_SPEC.md](10_EXPERIENCE_SCORING_SPEC.md) | Experience Phase 1–2 model |
| [11_CONFIDENCE_COVERAGE_PUBLICATION.md](11_CONFIDENCE_COVERAGE_PUBLICATION.md) | Confidence, quality gates, publication semantics |
| [24_PARTIAL_EVIDENCE_AND_CONFIDENCE.md](24_PARTIAL_EVIDENCE_AND_CONFIDENCE.md) | Partial manifests, scoring-confidence-v1, analysis vs publication |
| [12_CALIBRATION_INTEGRATION.md](12_CALIBRATION_INTEGRATION.md) | Adaptation of the admin calibration platform |
| [13_REFERENCE_COHORTS_AND_PHASE3_COMPARISONS.md](13_REFERENCE_COHORTS_AND_PHASE3_COMPARISONS.md) | Critical mass and population-relative scoring |
| [14_MIGRATION_ROLLOUT_AND_FEATURE_FLAGS.md](14_MIGRATION_ROLLOUT_AND_FEATURE_FLAGS.md) | Test reset, progressive rollout, rollback |
| [15_TESTING_VALIDATION_OBSERVABILITY.md](15_TESTING_VALIDATION_OBSERVABILITY.md) | Test matrix, probes, SLOs, diagnostics |
| [16_ABILITY_CATALOG_AND_MECHANICS_GOVERNANCE.md](16_ABILITY_CATALOG_AND_MECHANICS_GOVERNANCE.md) | Ability taxonomy and seasonal mechanic catalog |
| [17_SECURITY_PRIVACY_AND_PROVIDER_COMPLIANCE.md](17_SECURITY_PRIVACY_AND_PROVIDER_COMPLIANCE.md) | Secrets, account links, raw logs, attribution |
| [18_DECISIONS_AND_OPEN_QUESTIONS.md](18_DECISIONS_AND_OPEN_QUESTIONS.md) | Accepted decisions and unresolved items |
| [20_PROVIDER_FIELD_DICTIONARY.md](20_PROVIDER_FIELD_DICTIONARY.md) | Provider field dictionary |
| [21_END_TO_END_DATA_LINEAGE.md](21_END_TO_END_DATA_LINEAGE.md) | End-to-end data lineage |
| [22_RUN_ORCHESTRATION_AND_CACHE_LINEAGE.md](22_RUN_ORCHESTRATION_AND_CACHE_LINEAGE.md) | 16-run orchestration, three-layer cache, digest contract |
| [25_OPERATOR_SURFACE_AND_PIPELINE.md](25_OPERATOR_SURFACE_AND_PIPELINE.md) | Three public commands, self-healing lifecycle, publication |
| [02_WS02_WS03_INTERFACE.md](02_WS02_WS03_INTERFACE.md) | WS02/WS03 shared evidence interface |
| [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) | Workstream implementation status |

Related ops: [`../../operations/scoring-v2-runbooks.md`](../../operations/scoring-v2-runbooks.md), [`../../operations/scoring-v2-persistence-reset.md`](../../operations/scoring-v2-persistence-reset.md), [`../scoring-v2-live-facts-status.md`](../scoring-v2-live-facts-status.md).

## Normative language

- **MUST / MUST NOT**: required for correctness or safety.
- **SHOULD / SHOULD NOT**: expected default; deviations require an architecture decision.
- **MAY**: optional.
- **Shadow-only**: computed and persisted for research but excluded from public scoring.
- **Fail closed**: do not publish or silently downgrade semantics when an invariant cannot be proven.

## Baseline audit

The main branch already contains:

- WCL `points_and_damage` profile aggregation;
- run discovery and report/fight hydration;
- shared WCL evidence bundles;
- Survival V1.1.1 pressure-cluster analysis;
- Utility observed-contribution research logic;
- Experience V2;
- versioned score snapshots and run analyses;
- refresh admission and WCL rate-limit snapshots.

The calibration draft branch adds durable cohorts, frozen input bundles, a dedicated `calibration-run` queue, immutable reports, and an admin UI. The redesign must adapt these capabilities rather than duplicate them.

## Required implementation sequence

1. Freeze this specification and record unresolved decisions.
2. Implement Evidence Contract V2 without changing public scores.
3. Implement query planner, artifacts, normalized fact sets, and asynchronous analysis.
4. Integrate Phase 1 dimension models behind feature flags.
5. Adapt calibration to frozen V2 evidence.
6. Shadow-run V1 versus V2 and calibrate.
7. Publish V2 only after quality gates.
8. Implement Phase 2 contextual analysis.
9. Enable Phase 3 comparisons only after critical-mass gates.

No agent may skip directly to a scoring formula before the evidence and reproducibility layers exist.
