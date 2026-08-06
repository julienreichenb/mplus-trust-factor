---
status: proposed
normative: true
last_reviewed: 2026-08-01
repository: julienreichenb/mplus-trust-factor
baseline_main: 0b0d911f9c4f3ec771bd8f2390e972da01595f99
calibration_draft_branch: agent/11-scoring-calibration-study
calibration_draft_head_observed: 5603d4b8f01375599fa0bb71255b98d775cd8e4d
---


# Reference cohorts and Phase 3 comparisons

## 1. Purpose

Phase 3 introduces population-relative context such as comparison with strong players. It is not safe until the platform has enough independent, representative, stable evidence.

All Phase 3 terms begin shadow-only.

## 2. Reference unit

Reference facts are stratified by:

```text
season
partition
region
specialization
role
dungeon
key band
algorithm/catalog versions
```

A reference row derives from a character/run selected independently of the target model output.

## 3. Cohort sources

Allowed:

- expert-labelled S/A members;
- externally verifiable elite achievements/ranks;
- a previous frozen production model with explicit anti-circularity policy;
- curated research cohorts.

Prohibited:

- current candidate model selecting its own S/A references;
- current target score threshold without frozen prior version;
- duplicate alts/accounts treated as independent;
- best-parse cherry-picking.

## 4. Critical-mass gates

Initial per-slice minimums:

- at least 30 distinct characters;
- at least 20 independent accounts when account grouping is available;
- at least 100 runs;
- at least two regions or an explicitly region-scoped policy;
- maximum two runs per character/dungeon;
- no single character >5% of weighted sample;
- stable metrics across two collection windows.

These are initial governance thresholds and may be raised after variance audits.

## 5. Fallback hierarchy

Example:

```text
spec + dungeon + key band
→ spec + dungeon
→ role + dungeon + key band
→ role + dungeon
→ no comparison
```

Fallback is recorded in explanation. Never compare a specialization to an incompatible role-wide population without explicit policy.

## 6. Reference snapshot

```ts
interface ReferenceCohortSnapshot {
  id: string;
  schemaVersion: string;
  seasonId: string;
  partition: number | null;
  sliceKey: string;
  sourcePolicyVersion: string;
  evidenceCutoffAt: string;
  memberCount: number;
  accountCount: number | null;
  runCount: number;
  distributions: Record<string, FrozenDistribution>;
  limitations: string[];
  contentHash: string;
  status: "SHADOW" | "ELIGIBLE" | "RETIRED";
}
```

Distributions may store quantiles/histograms rather than identities.

## 7. Statistical safeguards

- winsorize only through versioned policy;
- retain raw diagnostics;
- bootstrap confidence intervals;
- monitor variance and drift;
- enforce minimum effective sample size;
- correct for repeated runs per player;
- separate meta and non-meta slices when meaningful;
- prevent data leakage across calibration splits.

## 8. Phase 3 dimension use

### Performance

- offensive cooldown timing;
- run parse distribution;
- high-key execution percentile.

### Survival

- death/pressure response distributions;
- avoidable damage;
- cooldown timing and availability.

### Utility

- successful/overlap/missed opportunity rates;
- strategic CC and support distribution;
- toolkit utilization breadth.

### Experience

No reference cohort is required for linked-account logic, though historical rank percentiles may use frozen population distributions.

## 9. Score influence

Reference-relative contribution is bounded.

Initial maximum contribution:

- no more than 20% of a dimension score;
- absolute Phase 1/2 evidence retains at least 80%;
- missing reference data removes the relative term without penalizing the target;
- reference confidence scales contribution.

## 10. Progressive activation states

```text
DISABLED
COLLECTING
SHADOW
RESEARCH_ELIGIBLE
PUBLIC_ELIGIBLE
ACTIVE
SUSPENDED
```

Automatic transition to ACTIVE is prohibited. Admin review is required.

## 11. Drift and suspension

Suspend a reference slice when:

- partition/patch changes;
- sample falls below minimum;
- metric distribution shifts materially;
- catalog changes;
- source policy changes;
- reference model becomes circular;
- data quality alerts exceed threshold.

## 12. Privacy

Public outputs expose aggregate percentiles and reference metadata, not cohort member identities unless already intentionally public and licensed.

## 13. Required tests

- insufficient sample remains shadow;
- duplicate accounts reduce effective sample;
- fallback hierarchy deterministic;
- target character excluded from its own reference distribution where required;
- model cannot select its own reference positives;
- version/hash changes invalidate old compatibility;
- missing reference does not lower absolute score;
- bounded influence enforced.
