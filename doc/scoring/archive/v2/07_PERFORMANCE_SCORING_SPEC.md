---
status: proposed
normative: true
last_reviewed: 2026-08-01
repository: julienreichenb/mplus-trust-factor
baseline_main: 0b0d911f9c4f3ec771bd8f2390e972da01595f99
calibration_draft_branch: agent/11-scoring-calibration-study
calibration_draft_head_observed: 5603d4b8f01375599fa0bb71255b98d775cd8e4d
---


# Performance scoring specification

## 1. Meaning

Performance estimates repeatable class/spec execution. Phase 1 uses WCL same-bracket parse information and WCL profile aggregates. It does not infer skill from raw DPS alone.

## 2. Evidence

### Required

- WCL `points_and_damage` adapted summary;
- active season and partition;
- per-dungeon best and median execution percentiles;
- selected manifest slots and their same-bracket parse percentiles;
- key level for each selected slot;
- resolved specialization and role;
- Season Difficulty Policy.

### Optional

- historical WCL aggregates;
- role-specific WCL ranking adapters;
- offensive cooldown facts in Phase 2.

## 3. Role adapters

### DPS

Primary run signal: `bracketPercent` or equivalent same-key-level percentile for the same specialization.

Fallback order:

1. validated bracket percentile;
2. validated run rank percentile with explicit semantics;
3. no run parse signal.

Raw DPS is explanatory only.

### Tank and healer

A DPS-only adapter MUST NOT be reused blindly.

Each role requires a verified WCL probe and adapter. Until validated:

- role Performance may use supported WCL role/playerscore rankings;
- unsupported run-level throughput remains unavailable;
- confidence/publication reflects missing role-specific evidence.

Healer HPS alone is prohibited because group damage demand is not controlled.

## 4. Season Difficulty Policy

A versioned policy supplies key thresholds:

```ts
interface SeasonDifficultyPolicy {
  id: string;
  seasonId: string;
  region: string;
  role: string;
  specSlug: string | null;
  effectiveFrom: string;
  k50: number;
  k90: number;
  k99: number;
  source: "PLATFORM" | "BLIZZARD" | "RAIDER_IO" | "MANUAL";
  sampleSize: number | null;
  confidence: number;
  version: string;
}
```

Fallback is a manual versioned policy. No hardcoded universal “high key” threshold.

## 5. Difficulty adjustment

Compress low-key percentile extremes and amplify high-key deviations around neutral 50:

```text
adjustedParse = clamp(50 + (parsePercentile - 50) × difficultyMultiplier, 0, 100)
```

Candidate initial multiplier curve:

- at/below low-season baseline: 0.75;
- at `K50`: 0.85;
- at `K90`: 1.00;
- at `K99`: 1.12;
- above `K99`: cap 1.15.

Interpolate linearly. These are initial calibration defaults, not immutable product truth.

## 6. Per-dungeon Phase 1 score

For two selected valid parses:

```text
peak        = max(adjustedParse1, adjustedParse2)
floor       = min(adjustedParse1, adjustedParse2)
consistency = 100 - abs(parse1 - parse2)

dungeonPerformance =
    0.40 × peak
  + 0.45 × floor
  + 0.15 × consistency
```

The floor is weighted slightly above peak so one exceptional parse cannot hide a weak second run.

For one valid parse:

```text
dungeonPerformance = adjustedParse
dungeonConfidence is capped
```

No missing second run is imputed.

## 7. Detailed season aggregate

Each active dungeon receives equal weight after producing a valid dungeon score.

```text
detailedSeasonPerformance = mean(valid dungeonPerformance values)
```

Equal weighting prevents heavily logged dungeons from dominating.

## 8. WCL profile stabilizer

```text
profilePerformance =
    0.45 × bestDpsPercentileAverage
  + 0.55 × medianDpsPercentileAverage
```

When per-dungeon aggregates are available, compute the same value from equal-weight active dungeons and compare it with WCL global values. Large disagreement is a diagnostic.

## 9. Blend

```text
slotCoverage = validDetailedPerformanceSlots / expectedSlots
detailedWeight =
  slotCoverage == 0
    ? 0
    : min(0.85, 0.25 + 0.60 × slotCoverage^1.5)

performance =
    detailedWeight × detailedSeasonPerformance
  + (1 - detailedWeight) × profilePerformance
```

If only one source is available, use it without inventing the other and reduce confidence.

The blend is versioned and calibration-adjustable.

## 10. Consistency semantics

Two consistency levels are retained:

- within-dungeon consistency: difference between selected slot parses;
- profile consistency: median versus best WCL aggregates.

Do not use standard deviation across arbitrary logged parses unless the underlying sample is explicitly available.

## 11. Confidence

Inputs:

- active dungeon coverage;
- valid detailed slot coverage;
- two-run dungeon share;
- profile aggregate availability;
- spec/role resolution;
- partition/season compatibility;
- freshness;
- adapter validity;
- high-key policy confidence.

WCL displayed total run count may contribute only a small contextual factor. It MUST NOT substitute detailed slot count.

## 12. Phase 2 — offensive cooldown execution

Ability catalog additions:

- cooldown and charges;
- talent/spec availability;
- cooldown-reduction/reset rules;
- active buff duration;
- offensive category;
- hold tolerance;
- encounter-specific exclusions.

Expected opportunities are computed from active-combat windows, not total dungeon duration.

Metrics:

- available opportunities;
- actual casts;
- use ratio;
- average delay after ready;
- overcap/unused duration;
- uptime for buff-style cooldowns;
- hold-window diagnostics.

Phase 2 Performance composition candidate:

```text
80% Phase 1 execution
20% offensive cooldown execution
```

Activate only after cross-spec catalog coverage and calibration.

## 13. Phase 3 — reference timing

Compare cooldown timing to frozen S/A reference cohorts by:

```text
season × partition × spec × dungeon × key band
```

Metrics may include:

- normalized timeline cast positions;
- boss/pull window alignment;
- usage count distribution;
- hold-duration distribution.

Reference-relative terms remain shadow-only until critical-mass gates pass.

## 14. Explanation payload

Expose:

- selected runs and key levels;
- raw and adjusted parse;
- difficulty policy thresholds/version;
- per-dungeon peak/floor/consistency;
- profile best/median stabilizer;
- coverage and missing slots;
- confidence limits;
- Phase 2/3 state.

## 15. Invalid practices

- selecting runs by best parse;
- multiplying raw parse directly by key level;
- treating missing run as parse zero;
- using total WCL run count as analyzed sample size;
- mixing partitions silently;
- using current overall score as high-key policy input without a frozen independent population.
