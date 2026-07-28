# default@3 methodology (Wave 4)

Active model: `default` version **3** (`default@3`).

Historical snapshots under `default@1` and `default@2` are preserved and never rewritten.

## Global Trust Score composition

**Skill score** (weighted dimensions only):

| Dimension | Global weight |
|---|---:|
| PERFORMANCE | 35% |
| SURVIVAL | 30% |
| UTILITY | 25% |
| EXPERIENCE | 10% |
| RAID | **0%** (excluded from active product mix) |

**Outside the weighted skill score:**

- **Confidence** — blended from dimension confidence, source coverage, freshness, and selected-run coverage; drives UNRATED presentation below `minConfidenceForGrade` (0.35).
- **Authenticity** — separate suspicion/mitigation blend (`skillWeight` 0.6 / `authenticityWeight` 0.4) applied after skill score to produce observed trust, then confidence-shrunk to overall Trust Score.

Renormalization happens only at the **global dimension** level when a dimension is genuinely unavailable (weight sum excludes zero-weight dimensions).

## Shared run selection (Agents 21–22)

All current-season execution dimensions (PERFORMANCE, SURVIVAL, UTILITY) use the same **eight-run set**:

- Exactly one highest-key run per active-season dungeon (up to eight).
- Equal dungeon weighting inside each dimension.
- Never replace an unlogged highest key with a lower logged key.
- Missing WCL/combat detail → contributor omitted; **never scored as zero**.

Public contract: `ScoringRunSelectionProfileDTO` on `CharacterProfileResponse.scoringRunSelection`.

## Dimension metrics and internal weights

### PERFORMANCE (global 35%)

| Metric key | Weight | Normalization |
|---|---:|---|
| `performance.v3.run_performance` | 1.0 | percentile |

Per dungeon (Agent 22, unchanged):

```text
runPerformance = 0.65 × executionPercentile + 0.35 × keyDifficultyPercentile
Performance = equal-weight mean(runPerformance)
```

Formula: `performance-v3-selected-runs-v1`. Historical seasons do **not** enter current Performance v3.

### SURVIVAL (global 30%)

| Metric key | Weight | Normalization |
|---|---:|---|
| `survival.v3.deaths` | 0.35 | identity |
| `survival.v3.avoidable_damage` | 0.30 | identity |
| `survival.v3.personal_defensives` | 0.20 | identity |
| `survival.v3.self_heal_and_potion` | 0.15 | identity |

Missing contributors dropped and remaining weights renormalized (Agent 23). Formula: `survival-v3-formula-v1`.

### UTILITY (global 25%)

| Metric key | Weight | Normalization |
|---|---:|---|
| `utility.v3.interrupts` | 0.40 | identity |
| `utility.v3.crowd_control` | 0.25 | identity |
| `utility.v3.group_support` | 0.20 | identity |
| `utility.v3.dispels` | 0.15 | identity |

Capability-aware renormalization when a spec lacks a category (Agent 24). Interrupt sub-blend: `0.70 × activity + 0.30 × success`. Formula: `utility-v3-1`.

### EXPERIENCE (global 10%)

| Metric key | Weight | Normalization |
|---|---:|---|
| `experience.current_peak` | 0.45 | identity |
| `experience.current_breadth` | 0.25 | identity |
| `experience.historical_peak` | 0.20 | identity |
| `experience.longevity` | 0.10 | identity |

Public mode: **CHARACTER_HISTORY** only (Agent 25). Missing `account_linked_alts` is unavailable, not a penalty. Formula: `experience-v3-v1`.

## Data sources

| Dimension | Primary sources |
|---|---|
| PERFORMANCE | WCL parse percentile + season key-difficulty calibration (Raider.IO cutoffs / bounded fallback) |
| SURVIVAL | WCL combat events + mechanic/ability catalogs |
| UTILITY | WCL casts/interrupts/dispels + ability catalog |
| EXPERIENCE | Raider.IO seasons / Blizzard Mythic+ rating |
| AUTHENTICITY | Derived boost/progression heuristics (not a skill dimension) |

## Missing-data behavior

- Unavailable provider fields → observation omitted; dimension renormalizes over available metrics.
- Unavailable dimension → excluded from skill-score weight sum (RAID always weight 0 on v3).
- Low confidence → dimension score shrinks toward neutral (50); overall grade may become UNRATED.

## Known limitations

- Mechanic/ability catalog coverage incomplete for some Midnight S1 dungeons (see `doc/wave4/data-coverage-wallidrixe.md`).
- Historical Experience normalization uses heuristic ceilings until per-season cutoffs are calibrated.
- Verified account history (`VERIFIED_ACCOUNT_HISTORY`) blocked without OAuth linkage.
- RAID metrics remain defined for snapshot compatibility but contribute **0%** to `default@3` skill score.
- UI radar and profile breakdown exclude RAID for Wave 4; older snapshots may still store RAID dimension rows.

## Worker wiring

Refresh pipeline (`apps/worker/src/orchestration/refresh-pipeline.ts`):

1. `analyzeScoringRuns` → eight-run selection + raw facts
2. `buildWclPerformanceObservations` → PERFORMANCE v3
3. `buildSurvivalObservations` → SURVIVAL v3
4. `buildUtilityObservations` → UTILITY v3
5. `buildExperienceObservations` → EXPERIENCE v3
6. Active model loaded from DB; v3 `metricWeights` patched per refresh for capability-aware SURVIVAL/UTILITY

Seed: `packages/database/src/seed.ts` — factory defaults: `packages/scoring/src/model/defaults.ts` → `createDefaultModelV3()`.
