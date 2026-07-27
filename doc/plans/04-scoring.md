# Agent 04 — Scoring / Boost Engine Plan

## Scope

Owned paths only:

- `packages/scoring/**`
- `packages/mechanics/**` (catalog abstractions + minimal seed)
- `doc/scoring/**`
- `tools/fixtures/scoring/**`
- `doc/plans/04-scoring.md`, `doc/agents/04-scoring.md`
- Optional: `doc/contracts/change-requests/04-*` if shared DTO extension is needed

No provider network calls, no Prisma client, no API/worker orchestration.

## Current baseline

- `@mplus/scoring` exports a neutral `calculateScore` placeholder (all dimensions ≈ 50).
- `@mplus/mechanics` has draft rule types + `validateMechanicRuleDraft` only.
- `@mplus/contracts` `ScoreModelConfig` is a slim public DTO (weights, blend, grades).
- DB seed stores a richer JSON config blob; Agent 4 owns the in-package model schema.

## Architecture

```text
NormalizedMetricObservation[] + ScoringContext + ScoreModelConfigV1
        │
        ▼
 calculateMetricScores  → per-metric normalized 0–100 + coverage
        │
        ▼
 calculateDimensionScores → weighted avg of available metrics,
                            coverage, shrink toward 50
        │
        ▼
 calculateAuthenticity → start 100, apply suspicion − mitigations,
                         evidence list, tags (never factual purchase)
        │
        ▼
 calculateFinalTrust → SkillScore → ObservedTrust → FinalTrust + grade
        │
        ▼
 explainScore → top ± contributors, missing metrics, public/admin text
```

Pure functions. Deterministic. Clock only via explicit `calculatedAt`. Fingerprint from immutable inputs + model key/version.

## Metric taxonomy (v1)

| Dimension | Metric key | Weight |
|-----------|------------|--------|
| PERFORMANCE | `performance.spec_percentile` | 0.55 |
| PERFORMANCE | `performance.consistency` | 0.25 |
| PERFORMANCE | `performance.contextual_contribution` | 0.20 |
| SURVIVAL | `survival.death_rate` | 0.35 |
| SURVIVAL | `survival.avoidable_damage` | 0.30 |
| SURVIVAL | `survival.defensive_usage` | 0.25 |
| SURVIVAL | `survival.consumable_usage` | 0.10 |
| UTILITY | `utility.interrupts` | 0.30 |
| UTILITY | `utility.crowd_control` | 0.25 |
| UTILITY | `utility.dispels` | 0.15 |
| UTILITY | `utility.externals` | 0.15 |
| UTILITY | `utility.class_specific` | 0.15 |
| EXPERIENCE | `experience.dungeon_breadth` | 0.35 |
| EXPERIENCE | `experience.top_level_repeat` | 0.25 |
| EXPERIENCE | `experience.volume_recency` | 0.15 |
| EXPERIENCE | `experience.historical_seasons` | 0.15 |
| EXPERIENCE | `experience.role_continuity` | 0.10 |
| RAID | `raid.mythic_progression` | 0.60 |
| RAID | `raid.mythic_parses` | 0.40 |

Dimension weights (default): Performance 0.32, Survival 0.27, Utility 0.23, ExperienceConsistency 0.13, MythicRaid 0.05.

## Normalization strategy

- All metric outputs clamped to `[0, 100]`.
- Config-driven strategies: `identity`, `percentile`, `logistic`, `piecewise`, `winsorize`, `season_decay`.
- No permanent hardcoded population percentiles in code; mapping tables live in model config.
- Raw DPS/HPS never compared across specs without role/spec context flags.
- Historical seasons: normalize within-season first, then apply decay weights (default 0.70 / 0.20 / 0.10).

## Missing-data handling

Per dimension:

1. Weighted average of **available** metrics only.
2. `coverage = sum(available weights) / sum(configured weights)`.
3. `dimensionConfidence` = blend of coverage, provider confidence, sample-size confidence.
4. `adjusted = confidence * raw + (1 - confidence) * neutral(50)`.
5. Emit missing contributors explicitly.
6. Optional extreme-cap when coverage < `minCoverageForExtreme`.

Overall confidence = configured blend of dimension confidence, source coverage, freshness, selected-run coverage.

## Confidence formula

Internal confidence ∈ `[0, 1]`. Public DTO may expose 0–100 or 0–1 consistently with contracts (contracts use `number`; we use 0–1 internally and document mapping).

```
FinalTrust = Confidence * ObservedTrust + (1 - Confidence) * 50
ObservedTrust = SkillScore * (0.60 + 0.40 * Authenticity / 100)
```

Blend weights configurable via model.

## Authenticity feature model

Start at 100. Subtract suspicion contributions; add mitigations (capped). Clamp `[0, 100]`.

Suspicion features (configurable weights): key-level jump, compressed best-run window, low volume for score, repeated stronger teammates, top-run roster concentration, weak target performance, high deaths/low contribution in top runs, rating/performance divergence, lack of intermediate progression.

Mitigations: confirmed elite main, probable reroll, strong prior-season same role, strong personal top-run performance, independent group diversity.

**Reroll mitigation** only softens progression-jump features; it cannot erase direct poor-performance evidence.

Tags (configurable thresholds):

- authenticity < 40 + adequate evidence → `BOOST_SUSPECTED`
- 40–60 → `ATYPICAL_PROGRESSION`
- low evidence → `INSUFFICIENT_DATA` (no boost tag)
- Never emit factual “purchased boost” language.

## Grade thresholds

Default: S ≥ 90, A ≥ 80, B ≥ 65, C ≥ 50, D < 50. Validated ordered descending.

## Role-specific differences

- **DPS**: standard performance weight on damage percentile/context.
- **Tank**: ignore raw HPS metrics; performance may include stability/mitigation keys; survival interprets expected tank damage (do not reward “low damage taken” naively without rules).
- **Healer**: HPS secondary/context-dependent; include offensive contribution when normalized; dispels/externals/group survival; avoid punishing low HPS in low-damage groups via role metric filters in model.

Role filters live in model config (`roleMetricOverrides`), not hardcoded branches scattered across formulas.

## Explainability output

- Top 3 positive / top 3 negative metric contributors
- Missing high-impact metrics
- Source categories present
- Major authenticity evidence
- Short public explanation + detailed admin explanation
- Model key/version + input fingerprint
- No secret event-by-event gaming surface beyond model metadata

## Mechanic catalog

- Types: avoidable, mandatory, soak, priority interrupt, CC, dispel/purge, defensive/external window
- Versioned catalog; matcher by season/dungeon/spell/NPC/role
- Empty catalog is valid; **unknown damage is never classified avoidable**
- Minimal seed fixture for tests only

## Core API surface

```ts
validateScoreModelConfig(config) → { ok, errors }
calculateMetricScores(input, model)
calculateDimensionScores(...)
calculateAuthenticity(...)
calculateFinalTrust(...)
gradeScore(score, thresholds)
explainScore(...)
calculateScore(...) // orchestrator → ScoreSnapshotDTO
```

Extended model type `ScoreModelConfigV1` lives in `@mplus/scoring` and is compatible with slim `@mplus/contracts.ScoreModelConfig` fields. Contract change request filed if Agent 5 needs the rich config on the public DTO.

## Golden test cohort

Synthetic profiles under `tools/fixtures/scoring/profiles/`:

1. Strong non-meta spec
2. Meta high rating, poor logs
3. Likely boosted low-volume + elite roster
4. Legitimate reroll + confirmed elite main
5. Excellent player, hidden logs (low confidence)
6. Average complete data
7. Sparse-data new player
8. Tank
9. Healer
10. Same player under default / survival-focused / utility-focused models

## Calibration / backtest approach

Documented in `doc/scoring/calibration-plan.md`: expert-labelled cohort, rank correlation, false-positive boost rate, spec/role distribution bias checks, version gate after backtest only.

## Self-review checklist

| Item | Decision |
|------|----------|
| Network/DB in scoring? | No |
| Missing → zero? | No; shrink to 50 |
| Boost language | Probabilistic tags only |
| Contract break? | Avoid; extend in-package; CR if needed |
| Determinism | Fingerprint + fixed formulas |
| Fixtures | Synthetic only |

## Implementation order

1. Mechanics types/catalog/matcher + seed
2. Scoring model defaults + validation
3. Metric → dimension → authenticity → trust → explain
4. Fixtures + unit/golden/property tests
5. Docs under `doc/scoring/**`
6. Lint / typecheck / test / build
7. Handoff `doc/agents/04-scoring.md` + commit

## Assumptions

- Upstream agents supply pre-normalized 0–100 observations when available; scoring may re-normalize when `rawValue` + strategy is provided.
- `MetricObservationDTO.confidence` is 0–1.
- Slim contract `ScoreModelConfig` remains the public snapshot metadata shape; rich config is scoring-package-local until a coordinated contract upgrade.
- Vitest alias for `@mplus/mechanics` added in root `vitest.config.ts` (test harness only; no package ownership conflict).
