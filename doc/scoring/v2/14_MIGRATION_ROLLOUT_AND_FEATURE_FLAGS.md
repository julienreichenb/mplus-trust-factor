---
status: proposed
normative: true
last_reviewed: 2026-08-01
repository: julienreichenb/mplus-trust-factor
baseline_main: 0b0d911f9c4f3ec771bd8f2390e972da01595f99
calibration_draft_branch: agent/11-scoring-calibration-study
calibration_draft_head_observed: 5603d4b8f01375599fa0bb71255b98d775cd8e4d
---


# Migration, rollout, and feature flags

## 1. Strategy

The product is in test. Correct architecture takes priority over preserving experimental data. A destructive reset is acceptable when it reduces long-term complexity.

Implementation remains progressive to isolate failures and compare V1/V2.

## 2. Recommended rollout

### Stage 0 — documentation and probes

- freeze contracts;
- validate external schemas;
- create fixtures;
- no DB/public changes.

### Stage 1 — schema and artifacts

- add V2 tables/storage;
- preserve V1;
- no V2 provider fan-out.

### Stage 2 — selection shadow

- discover/hydrate candidates;
- freeze 2×dungeon manifests;
- no detailed V2 scoring;
- audit coverage and cost.

### Stage 3 — evidence/fact shadow

- fetch selected datasets;
- persist artifacts/facts;
- compare cache cost;
- no public scoring.

### Stage 4 — dimension shadow

- calculate four V2 dimensions;
- store `SHADOW`;
- calibration replay;
- no public pointer.

### Stage 5 — candidate publication

- eligible admins/test identities only;
- V1 remains public fallback;
- UI comparison.

### Stage 6 — test cutover

- activate V2 model in test;
- reset/rebuild test scores if chosen;
- monitor.

### Stage 7 — broader rollout

- canary percentages;
- production only after explicit approval.

### Stage 8 — V1 retirement

- stop V1 writes;
- retain historical snapshots;
- remove legacy code/data after retention review.

## 3. Feature flags

Suggested flags:

```text
SCORING_V2_ENABLED=false
SCORING_V2_SELECTION_ENABLED=false
SCORING_V2_EVIDENCE_FETCH_ENABLED=false
SCORING_V2_DIMENSIONS_ENABLED=false
SCORING_V2_PUBLICATION_ENABLED=false
SCORING_V2_PERFORMANCE_ENABLED=false
SCORING_V2_SURVIVAL_ENABLED=false
SCORING_V2_UTILITY_ENABLED=false
SCORING_V2_EXPERIENCE_ENABLED=false
SCORING_V2_RELATIVE_DAMAGE_MODE=off|shadow|active
SCORING_V2_UTILITY_OPPORTUNITY_MODE=off|shadow|active
SCORING_V2_REFERENCE_COMPARISON_MODE=off|collect|shadow|active
CALIBRATION_V2_ENABLED=false
```

Defaults fail closed/off. API and worker flags must agree in readiness diagnostics.

## 4. Destructive test reset gate

A reset requires:

- current backup;
- explicit environment check `APP_ENV=test`;
- typed confirmation token;
- no production database hostname;
- migration/seed validation on disposable DB;
- calibration label export;
- rollback instructions;
- post-reset smoke suite.

## 5. Dual-run comparison

For the same refresh:

- V1 and V2 may consume different evidence, so comparison report must expose evidence differences;
- V2 runs never alter V1 public pointer in shadow;
- provider calls should be shared where compatible;
- cost overhead measured explicitly.

## 6. Activation criteria

Before V2 public activation in test:

- manifest selector deterministic;
- target coverage reached on calibration/test cohort;
- no cross-dimension manifest mismatch;
- provider cost within budget;
- no unbounded JSONB growth;
- all full suites green;
- failure injection passes;
- calibration report reviewed;
- score movement explainable;
- rollback tested.

## 7. Rollback

Rollback options:

1. disable V2 publication and restore V1 pointer;
2. activate previous score model;
3. stop V2 evidence jobs but retain artifacts;
4. rollback application without destructive schema downgrade;
5. restore DB only for migration corruption.

Never delete V2 evidence as part of immediate rollback.

## 8. Calibration feature adaptation

The calibration draft PR may continue independently, but before merge/cutover:

- rebase against V2 contracts where necessary;
- support both bundle V1 and V2 explicitly;
- keep V2 calibration flag off;
- do not activate a draft model automatically;
- preserve existing Phase 1 reports.

## 9. Deployment constraints

- one deployment owner per environment;
- no competing `.env` watcher and CD rollout;
- application services must run the same image SHA;
- migrations execute before service rollout;
- health endpoint reports revision and relevant feature modes;
- readiness fails on incompatible API/worker contract versions.
