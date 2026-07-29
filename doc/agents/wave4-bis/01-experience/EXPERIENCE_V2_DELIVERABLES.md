# Agent 37 — Experience Rework Deliverables

Branch: `agent/wave4.3-experience`  
Trust Experience weight: **unchanged at 10%**.

## 1. Exact current-state explanation (pre-V2)

Public Experience was **CHARACTER_HISTORY only** (no alt graph).

Builder: `buildCharacterHistoryExperienceObservations` in `packages/scoring/src/experience/character-history.ts`.  
Caller: `apps/worker/src/orchestration/refresh-pipeline.ts`.

| Metric | Signal | Problem |
|---|---|---|
| `experience.dungeon_breadth` | distinct selected dungeons / expected | Keep — true exposure |
| `experience.top_level_repeat` | runs at peak key | Overlaps Performance (skill/peak) |
| `experience.volume_recency` | selected run count / expected | Rewards spam; “recency” unused |
| `experience.mythic_rating` | Blizzard rating vs cutoffs | Skill/progression proxy |
| `experience.historical_seasons` | `priorSeasonCount` 0/1 | RIO requested **current only**; almost always 0 |
| `experience.role_continuity` | `character.role ? 1 : null` | Vanity binary |

Aggregation: standard dimension weighted mean + confidence shrink toward 50 (`packages/scoring/src/dimensions.ts`).  
Trust weight key: `experienceConsistency = 0.10`.

**Wallidrixe worked example (V1-shaped):** full 8-dungeon selection + rating ~2800 + prior=1 + role=1 → Experience raw ≈ mid-70s under model v2/v3. No persisted Experience-only fixture existed; publication stubs used score 70.

## 2. Current formula and source map (V1)

**Sources reachable from Experience:** Blizzard keystone profile/season runs, Raider.IO profile (runs + optional previous season), fused selected runs. **No WCL combat-event calls.**

**Unavailable paths:** no observations → `UNAVAILABLE`; coherence `DIMENSION_REGRESSION` if published Experience disappears; Experience was **not** in `failedDimensions` → provider outage could overwrite LKG with empty/low Experience.

## 3. Weaknesses and overlap

- Mythic rating + peak-key repeat duplicate Performance-adjacent skill.
- Volume without diminishing returns.
- Historical seasons effectively broken (RIO field set).
- Role continuity meaningless.
- Missing LKG on Experience provider failure.
- Confirmed empty vs provider failure not distinguished.

## 4. Experience V2 semantics

> How much relevant Mythic+ context has this character accumulated, independently of how well they performed?

**Kept:** dungeon breadth, multi-season continuity, participation (with diminishing returns), key-band breadth, activity recency.  
**Rejected:** mythic rating, peak-key repeat, raw volume spam, binary role presence, unauthenticated alts.

**Score 50 meaning:** moderate current-season coverage — ~half the active dungeon pool across ~2 key bands, with recent activity **or** prior-season history. Not a population percentile.

**History modes:**
- Public: `CHARACTER_HISTORY` only.
- Future: `VERIFIED_ACCOUNT_HISTORY` after Battle.net linking (private, not mixed into public Trust).

## 5. Source-consolidation matrix

| Input | Authority | Freshness | Depth | Cost | WCL events? | V2 use |
|---|---|---|---|---|---|---|
| Blizzard keystone/season runs | High for current season | Session fetch | Current season | 1–2 calls | No | Selected + pool runs |
| Blizzard character profile | Role/spec only | Session | — | Already fetched | No | Not scored |
| Raider.IO profile + current:previous seasons | Medium | Crawl lag | Current + previous | Same profile call | No | Runs + `priorSeasonCount` |
| WCL rankings/combat | High combat | Expensive | Per-run | High | Yes | **Not used** |
| Persisted observations/runs | Local | As published | Full refresh history | Zero | No | Prefer for recalculation |

Rule: Experience is calculable from durable aggregate/profile/run metadata.

## 6. Formulas and component weights (model v5)

Trust weights unchanged. Experience metrics:

| Metric | Weight | Normalization |
|---|---:|---|
| `experience.dungeon_breadth` | 0.30 | `distinctDungeons / expected * 100` |
| `experience.key_band_breadth` | 0.22 | `bandsTouched / 4 * 100` (bands 2–4,5–7,8–9,10–11,12–14,15+) |
| `experience.participation_depth` | 0.20 | `log1p(min(runs, expected*2.5)) / log1p(expected*2.5) * 100` |
| `experience.historical_seasons` | 0.18 | `priorSeasonCount / 3 * 100` |
| `experience.activity_recency` | 0.10 | Full ≤14d; linear to floor 20 by 90d; hard floor 12 |

`experience.mythic_rating` may still be stored as explanatory (`scoringWeight: 0`, `retiredFromExperienceV2`).

## 7. Confidence model

Separated from score:

- Provenance: `CONFIRMED_ABSENCE` | `HAS_HISTORY` | `PARTIAL_SOURCES` | `PROVIDER_FAILURE`
- Observation confidence from provenance (+ mild discounts per component)
- Dimension confidence unchanged engine blend (coverage + provider conf)
- Small samples → lower confidence via existing sample-size half-life
- `PROVIDER_FAILURE` → dimension marked failed → **LKG preserved** (never forced UNAVAILABLE)

## 8. Before/after calibration panel

Offline panel in `packages/scoring/src/experience/v2/calibration.ts` (archetypes, not named tuning):

| Profile | Expectation |
|---|---|
| new-character | Valid low score, non-UNAVAILABLE |
| active-current | Above mid |
| multi-season | Highest among peers |
| returning-veteran | Recency down, history still valuable |
| many-low-keys | Strong breadth; not skill-inflated |
| fewer-high-keys | Lower breadth than many-low |
| incomplete-provider | Partial confidence |
| provider-failure-lkg | Provenance failure (LKG externally) |
| spam-one-dungeon | Cannot beat broad many-low-keys |

Ablations: `ablateExperienceV2` zeros each component.

## 9. Migration and versioning

- Model **v5** active (`createDefaultModelV5`, seed ACTIVE, `ACTIVE_SCORE_MODEL_VERSION` default **5**).
- Observation context: `schemaVersion=experience-v2`, `analysisVersion=experience-v2.0`.
- V1 builder retained for lock tests.
- Reuses existing publication/coherence/LKG — no parallel snapshot system.
- Model-only recalculation from persisted observations performs zero provider calls.

## 10. API / provider-call impact

- RIO fields: `mythic_plus_scores_by_season:current:previous` (same call, richer payload).
- No new Blizzard endpoints; no WCL combat calls for Experience.
- Public GET unchanged (still reads published snapshot only).

## 11. Files changed

- `packages/scoring/src/experience/v2/**` — V2 compute, observations, calibration, tests
- `packages/scoring/src/experience/character-history.ts` — retained (V1 lock)
- `packages/scoring/src/model/defaults.ts` — `createDefaultModelV5`
- `packages/scoring/src/index.ts` — exports
- `packages/database/src/seed.ts` — model v5 + metric defs
- `packages/config/src/index.ts` — default model version 5
- `packages/providers/raiderio/src/fields.ts` — previous season field
- `apps/worker/src/orchestration/refresh-pipeline.ts` — V2 builder + Experience LKG

## 12. Tests

- V1 lock: `character-history.v1.lock.test.ts`
- V2 + required cases: `experience/v2/experience-v2.test.ts`
- Present/independence: `present.test.ts`
- RIO fields + config defaults updated

## 13. Commit hash

Filled after commit.
