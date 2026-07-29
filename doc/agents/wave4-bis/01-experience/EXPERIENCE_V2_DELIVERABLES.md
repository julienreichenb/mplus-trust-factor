# Agent 37 — Experience Rework Deliverables

Branch: `agent/wave4.3-experience`  
Trust Experience weight: **unchanged at 10%**.  
Status: **accepted direction; not merge-ready until product signs rollout**.

## Corrected formulas (Experience V2.1)

Trust weights unchanged. Experience metrics (model v5):

| Metric | Weight | Normalization |
|---|---:|---|
| `experience.dungeon_breadth` | 0.30 | `clamp01(distinctDungeons / expected) * 100` |
| `experience.key_band_breadth` | 0.22 | `clamp01(bandsTouched / 6) * 100` |
| `experience.participation_depth` | 0.20 | `log1p(min(runs, expected*2.5)) / log1p(expected*2.5) * 100` |
| `experience.historical_seasons` | 0.18 | `clamp01(priorSeasonCount / sourceDepth) * 100` |
| `experience.activity_recency` | 0.10 | Full ≤14d; linear to floor 20 by 90d; hard floor 12 |

### key_band_breadth

Six defined bands: `2–4`, `5–7`, `8–9`, `10–11`, `12–14`, `15+`.  
Denominator **`KEY_BAND_COUNT = 6`** (equals the band definition length).  
Hard clamp keeps every component in `[0, 100]`.

### historical_seasons

| Source | Max prior seasons | `sourceDepth` |
|---|---:|---:|
| Raider.IO `mythic_plus_scores_by_season:current:previous` | 1 | **1** |
| Durable local prior seasons (score snapshots ∪ mythic runs outside active season) | up to 3 | `min(3, max(localCount, 1))` when localCount > 0 |

`priorSeasonCount = min(3, max(rioPrior, localPrior))`.  
RIO-only characters can reach **100** with previous season present (depth 1).  
Never uses `/3` when only RIO depth is available (avoids 33.3 ceiling).

**Score 50 meaning:** ~half dungeon pool across ~3 of 6 key bands, with recent activity or prior-season history.

---

## Real-data V4 vs V5 comparison (persisted inputs, 0 provider calls)

Offline suite: `packages/scoring/src/experience/v2/v4-v5-comparison.test.ts`.  
Shared Performance + Survival observations held constant; only Experience builder/model changes.

| Persona | Exp V4 | Conf V4 | Exp V5 | Conf V5 | Overall V4 | Overall V5 | Trust Δ | Provider calls |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Wallidrixe-shaped | 72.77 | 0.853 | 80.61 | 0.883 | 62.51 | 63.22 | **+0.71** | **0** |
| New character | 32.49 | 0.350 | 7.77 | 0.845 | 58.52 | 56.89 | **-1.63** | **0** |
| Active single-season | 74.84 | 0.711 | 63.34 | 0.882 | 62.43 | 61.72 | **-0.71** | **0** |
| Returning multi-season | 41.08 | 0.768 | 47.73 | 0.883 | 59.66 | 60.37 | **+0.71** | **0** |
| Spam-one-dungeon | 32.83 | 0.711 | 38.90 | 0.882 | 58.88 | 59.60 | **+0.73** | **0** |

Notes:
- V5 new-character score is legitimately low with **higher** confidence (confirmed absence ≠ provider failure).
- V5 Wallidrixe rises without mythic-rating skill inflation in the weighted Experience mix (rating may still appear as non-scoring explanatory obs in live refresh).
- Spam remains below active single-season on V5 Experience.
- Local recalculation performed **zero** provider calls.

---

## Model activation and rollout

### Published V4 snapshots remain visible

- Public GET reads `character_published_scores` → published `score_snapshots` for the **score model id that was published**.
- Activating model v5 does **not** rewrite published v4 rows.
- Until a character is refreshed under v5 and passes coherence, the last published snapshot (often v4) stays visible.

### How V5 candidates are recalculated

1. Seed/activate `default` model **version 5** (`ACTIVE_SCORE_MODEL_VERSION=5`).
2. Refresh builds Experience V2 observations (`schemaVersion=experience-v2`, `analysisVersion=experience-v2.1`).
3. Score engine uses v5 metric weights; publishes a new candidate after coherence.
4. Model-only path: load persisted observations + `calculateScore(createDefaultModelV5())` → **zero provider calls**.

### Database backfill

- **Not required** for correctness of public reads.
- Optional: batch refresh / model-only recalculation to move characters onto v5 Experience metrics.
- Metric definitions for new keys are upserted on first write (`ensureMetricDefinition` upsert).

### Rollback to V4

1. Set `ScoreModel` v4 → `ACTIVE`, v5 → `ARCHIVED` (or set `ACTIVE_SCORE_MODEL_VERSION=4` and re-seed).
2. New refreshes score with v4 Experience weights (V1 metric keys).
3. Published v5 snapshots remain in history; public pointer can stay on last published until a v4 refresh republishes.
4. Coherence still blocks Experience disappearance vs the currently published snapshot.

### Failed Experience refresh → LKG

- When Blizzard **and** Raider.IO soft-skip → `experienceProvenance = PROVIDER_FAILURE` → `failedDimensions.add("EXPERIENCE")`.
- `mergeObservationsWithLastKnownGood` keeps persisted Experience observations.
- Coherence rejects candidates that drop a previously available Experience dimension.

---

## Full test status

### This branch (after corrective fixes)

- `pnpm build`: **pass**
- `pnpm test`: **102 files passed**, **708 tests passed**, 4 skipped

### WCL probe failures (investigated vs integration)

Identical command on **`integration/wave4.3` @ `1d16bc1`** originally failed both:

1. `shared-evidence.test.ts` — `isPlayerDeadDuringWindow is not a function`
2. `utility-v3-regression.test.ts` — `ENOENT` for non-git `raw-artifacts/.../07-utility-normalized-runs.json`

**Fixes on this branch:**

1. Implemented `isPlayerDeadDuringWindow` and wired death → `NOT_APPLICABLE` in opportunity extraction.
2. Wallidrixe utility regression **skips** when the optional raw artifact directory is absent.

Those failures were **pre-existing on integration**, not introduced by Experience V2. After the fix, the full suite is green on this branch.

---

## Legacy audit (V1) — condensed

Public Experience was CHARACTER_HISTORY only. Builder: `character-history.ts`. Overlaps: mythic rating + peak-key repeat. RIO previously requested `current` only.

---

## Files (corrective pass)

- `packages/scoring/src/experience/v2/**` — band denominator 6, depth-aware seasons, comparison tests
- `apps/worker/.../refresh-pipeline.ts` — local prior-season consolidation
- `packages/providers/warcraftlogs/...` — death-window helper + optional fixture skip
- This document

## Commit hashes

- Initial V2: `84a9ed726191a3504e85395fd07d1ca8487698ac`
- Corrective (formulas + calibration + WCL + rollout): `09ef3b54c0991a51d964b35a701a22c08684d865`
