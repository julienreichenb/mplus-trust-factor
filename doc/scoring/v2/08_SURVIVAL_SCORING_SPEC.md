---
status: proposed
normative: true
last_reviewed: 2026-08-01
repository: julienreichenb/mplus-trust-factor
baseline_main: 0b0d911f9c4f3ec771bd8f2390e972da01595f99
calibration_draft_branch: agent/11-scoring-calibration-study
calibration_draft_head_observed: 5603d4b8f01375599fa0bb71255b98d775cd8e4d
---


# Survival scoring specification

## 1. Meaning

Survival measures whether a player avoids deaths and responds appropriately to danger. It is not a percentile and is not based on raw damage volume alone.

## 2. Phase 1 evidence

Per selected manifest slot:

- deaths attributed to the target;
- fight duration and active-combat duration;
- casts and buffs for personal defensives/immunities;
- damage taken with health resources where required;
- self-healing and consumable healing;
- specialization/talent toolkit;
- non-tank group damage summary for shadow/validated relative-damage metric;
- mechanic exclusions where available.

## 3. Phase 1 components

Candidate production composition:

```text
50% survival outcome
25% defensive usage
15% emergency recovery
10% relative avoidable damage
```

Relative damage begins shadow-only. Until activation, available component weights renormalize to 55/30/15, consistent with the current Survival V1.1.1 structure.

### 3.1 Outcome

Initial run mapping:

| Deaths | Score |
|---:|---:|
| 0 | 100 |
| 1 | 65 |
| 2 | 30 |
| ≥3 | 0 |

Persist death timestamps and cause metadata for explanation. Key difficulty may affect confidence or a small calibrated adjustment, but cannot erase repeated deaths.

### 3.2 Defensive usage

Phase 1 counts activations by category:

- major defensive;
- minor defensive;
- immunity;
- absorb/shield;
- health-increasing defensive.

Normalize by active-combat hour and applicable toolkit, not total dungeon time.

A saturating curve maps observed rate to 0–100. Catalog gaps reduce confidence. Phase 1 does not claim the activation was well timed.

### 3.3 Emergency recovery

Identify eligible danger windows:

- health below configured ratio, initially 35%;
- or large/rolling damage trigger;
- pressure-cluster merge rules.

Useful recovery includes:

- self-heal;
- healthstone where observable;
- healing potion where observable;
- class-specific emergency recovery.

Score:

```text
recoveryCoverage =
  useful eligible recovery windows
  / eligible recovery windows
```

No eligible window means component unavailable, not 100.

### 3.4 Relative avoidable damage

Initial shadow method:

1. exclude tanks;
2. compute target damage per active-combat second;
3. remove self-damage and known mandatory damage where cataloged;
4. compare with non-tank group median;
5. apply class/spec passive-mitigation caveats;
6. cap influence;
7. mark `UNRELIABLE` when group or mechanic coverage is insufficient.

Do not activate until fixture/live audit demonstrates class fairness.

## 4. Pressure clusters

Retain and version current concepts:

- low-health threshold;
- rolling damage window;
- large-hit threshold;
- merge gap;
- stable recovery threshold;
- continuous pressure gap.

Each cluster records:

- start/end;
- trigger types;
- HP evidence quality;
- damage amount;
- defensives active/cast;
- self-recovery actions;
- death outcome;
- availability state in Phase 2.

## 5. Per-run score

```text
runSurvival =
  weightedMean(available component scores)
```

Missing components are omitted only when semantically unavailable. Missing required evidence lowers confidence and may invalidate the run.

## 6. Per-dungeon and season aggregation

For each dungeon:

```text
dungeonSurvival = median(valid selected-run scores)
```

With two runs, the median is their mean. Across dungeons:

```text
seasonSurvival = equal-weight mean(valid dungeonSurvival)
```

Equal dungeon weighting prevents one heavily eventful run from dominating.

## 7. Confidence

Inputs:

- valid slot and dungeon coverage;
- health-resource coverage;
- defensive catalog coverage;
- self-heal catalog coverage;
- mechanic exclusion coverage;
- truncation;
- active-combat detection;
- relative-damage reliability;
- fresh compatible report revisions.

Confidence caps apply to outcome-only or partial-behavioral modes.

## 8. Phase 2 — timing and availability

### 8.1 Response classes

For each danger cluster:

- `PREEMPTIVE`: defensive active before first meaningful damage;
- `REACTIVE`: cast shortly after pressure begins;
- `LATE`: cast after most pressure or after fatal sequence;
- `NONE`: no qualifying response.

Initial credit candidates:

```text
PREEMPTIVE 1.00
REACTIVE   0.65
LATE       0.25
NONE       0.00
```

### 8.2 Availability

Determine whether a suitable defensive was:

- ready;
- already active;
- on cooldown;
- charge unavailable;
- not talented;
- reset by mechanic/talent;
- unknown.

A `NONE` response is heavily penalized only when a relevant action was available and evidence is reliable.

### 8.3 Mitigation effect

Where WCL evidence permits, estimate:

- absorb amount;
- reduced incoming damage;
- immunity coverage;
- damage before/after activation;
- target survival outcome.

Avoid claiming exact mitigation for abilities or mechanics without measurable evidence.

## 9. Phase 3 — reference comparison

Reference slices:

```text
season × partition × spec × dungeon × key band
```

Compare:

- deaths per active-combat hour;
- avoidable damage ratio;
- pressure-cluster coverage;
- preemptive/reactive share;
- emergency recovery share;
- defensive activation rate;
- cooldown waste/availability.

Fallback to wider slices only through documented hierarchy. No comparison when sample minimums are unmet.

## 10. Explanation payload

Expose:

- two selected runs per dungeon;
- deaths and cluster counts;
- defensive/recovery counts;
- evidence mode;
- component scores and weights;
- unavailable components;
- catalog coverage;
- relative-damage shadow/active status;
- confidence caps and reasons.

## 11. Invalid practices

- penalizing all raw damage equally;
- comparing tank damage with non-tanks;
- treating no low-health window as perfect self-heal usage;
- assuming potion availability;
- penalizing unavailable/not-talented cooldowns;
- counting duplicated pressure triggers as separate failures;
- comparing across classes without stratification.
