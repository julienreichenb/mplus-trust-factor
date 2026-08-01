---
status: proposed
normative: true
last_reviewed: 2026-08-01
repository: julienreichenb/mplus-trust-factor
baseline_main: 0b0d911f9c4f3ec771bd8f2390e972da01595f99
calibration_draft_branch: agent/11-scoring-calibration-study
calibration_draft_head_observed: 5603d4b8f01375599fa0bb71255b98d775cd8e4d
---


# Calibration integration with Scoring V2

## 1. Existing calibration capability

The draft calibration platform provides:

- reusable expert-labelled cohorts;
- immutable cohort revisions;
- preflight;
- frozen input bundles with SHA-256 and size bounds;
- dedicated `calibration-run` BullMQ queue;
- provider-free backtests;
- immutable reports and deterministic digest;
- admin API/UI;
- modes for persisted snapshots, draft evaluation, and active-versus-draft.

Scoring V2 must adapt this platform rather than build a second calibration system.

## 2. Core change

Current bundles are snapshot-oriented. V2 calibration bundles must freeze the full replay graph:

```text
cohort label
→ evidence manifest
→ selected slot fact sets
→ dimension inputs
→ active/draft model configurations
→ deterministic calculations
```

No calibration run may query external providers.

## 3. Calibration Input Bundle V2

```ts
interface CalibrationInputBundleV2 {
  schemaVersion: "2.0.0";
  generatedAt: string;
  evidenceCutoffAt: string;
  cohort: FrozenCohortRevision;
  season: FrozenSeasonBinding;
  activeModel: FrozenScoreModel | null;
  evaluationModel: FrozenScoreModel | null;
  policies: {
    difficultyPolicies: FrozenPolicy[];
    abilityCatalogVersions: string[];
    mechanicCatalogVersions: string[];
    confidenceAlgorithmVersions: Record<string, string>;
  };
  members: CalibrationMemberReplayV2[];
  bundleHash: string;
}
```

Each member includes:

- expert expected label and rationale;
- identity/spec/role;
- inclusion/exclusion state;
- manifest document/hash;
- slot list;
- fact-set documents/hashes;
- metric inputs;
- evidence quality;
- previous persisted snapshot for comparison when requested.

## 4. Bundle size

The current 4 MiB JSONB limit may be insufficient for V2 if full fact sets are embedded.

Preferred design:

- bundle manifest JSON remains bounded;
- referenced fact-set documents/artifacts are frozen by content hash;
- create an export artifact package for portable replay;
- verify every referenced hash before run;
- database row stores the root manifest and references, not raw WCL events.

Calibration MUST never depend on mutable external rows without frozen hashes.

## 5. Preflight V2

Per member verify:

- character bootstrap complete;
- expected label provided independently;
- season/spec/role compatible;
- Evidence Manifest V2 exists and is frozen;
- minimum coverage policy;
- all fact-set hashes resolvable;
- required algorithm/catalog versions installed;
- active/draft model compatible;
- no provider work required;
- no score-to-label leakage;
- duplicate account/character grouping policy;
- evidence cutoff respected.

Preflight outputs blocking/warning/info issues.

## 6. Modes

### Persisted snapshot only

Evaluates current published/persisted outcomes against labels. Does not recompute dimensions.

### Draft model evaluate

Replays frozen V2 inputs through one DRAFT model. May vary weights/formulas only within supported algorithm versions.

### Active versus draft

Uses identical member evidence and frozen policies for both models. Differences must be attributable to model/algorithm changes, never evidence drift.

### Future ablation/research

May test component removal or bounded parameters but produces no activation and remains explicit research mode.

## 7. Calibration statistics

Required overall metrics:

- Spearman rank correlation;
- pairwise concordance;
- label/grade confusion;
- mean/median score and confidence;
- outliers;
- coverage and exclusion rates;
- score/rank movement active versus draft.

Required slices:

- role;
- class;
- specialization;
- meta/non-meta policy;
- evidence coverage state;
- detailed slot count;
- key-level band;
- region;
- dimension confidence band.

Minimum slice sizes are enforced; small slices are reported but not interpreted as recommendations.

## 8. Scoring V2 diagnostics

Reports add:

- performance profile-versus-detailed disagreement;
- one-run versus two-run dungeon sensitivity;
- high-key difficulty adjustment impact;
- Survival component saturation;
- Utility neutral-floor and opportunity-mode impact;
- Experience provider-state distribution;
- missing-dataset reasons;
- cost/coverage relationship;
- provisional publication rate.

## 9. Evidence refresh policy

Calibration evidence is immutable. To refresh:

1. create a new evidence manifest/fact-set generation;
2. create a new cohort revision or explicit evidence revision;
3. run a new calibration;
4. compare results.

Never mutate an existing run’s bundle.

## 10. Draft model lifecycle

Calibration endpoints may create DRAFT models only.

Activation remains a separate audited operation requiring:

- successful calibration report;
- quality thresholds;
- regression review;
- explicit user/admin action;
- no in-place mutation of source model;
- rollout plan and rollback model.

## 11. Integration migration

1. add bundle schema V2 alongside V1;
2. add V2 preflight checks;
3. export V2 facts from shadow pipeline;
4. replay current Agent 11 cohort;
5. compare V1 and V2;
6. update admin report tabs;
7. deprecate V1 snapshot-only evidence after V2 acceptance;
8. preserve old reports as historical.

## 12. Test requirements

- same frozen evidence for active and draft;
- hash verification fails closed;
- missing fact artifact blocks run;
- no provider/refresh calls;
- deterministic byte-identical report;
- source model immutable;
- new model DRAFT only;
- old reports survive catalog/model changes;
- cohort label never derived from score;
- V1 and V2 bundle dispatch explicit;
- small-slice limitation reported;
- calibration queue remains isolated.
