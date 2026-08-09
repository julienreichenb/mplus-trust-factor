# Latest Handoff

## Step
Agent 04 complete — native Raider.IO cutoff band standing + partial-policy fail-closed + policy v2 compatibility.

## Product decisions locked
See `PRODUCT_DECISIONS.md`. Agent 02 season binding + Agent 03 persistence/acquisition remain authoritative.

## Agent 04 outcomes

### Final native-band scoring model
Previous-season standing uses discrete provider-native bands (no interpolation):

| Condition | Standing |
|-----------|----------|
| rating ≥ p999 | 100 |
| ≥ p990 and &lt; p999 | 90 |
| ≥ p900 and &lt; p990 | 75 |
| ≥ p750 and &lt; p900 | 60 |
| ≥ p600 and &lt; p750 | 45 |
| &lt; p600 | 25 |
| `CONFIRMED_NO_ACTIVITY` | 0 |

Equality belongs to the stronger band whose cutoff is met.

Experience remains:

```text
max(previousStandingScore, classRankFloor?, eliteFloor?)
```

Class-rank floors and elite floor 90 are unchanged. Class-rank stays fail-closed without exact-season rank evidence.

### Policy / version changes
- `SEASON_POPULATION_POLICY_VERSION` → `season-population-policy-v2`
- Store schema → `experience-population-policy-store-v2`
- Scorer rejects incompatible policy versions (`INCOMPATIBLE_POLICY_VERSION`)

### Partial-policy behavior
Score only when the native band is unambiguous from present thresholds:
- p999 present + rating ≥ p999 → 100
- p600 present + rating &lt; p600 → 25
- missing upper discriminator (e.g. no p999 while rating ≥ p990) → `AMBIGUOUS_PARTIAL_POLICY`
- missing middle discriminator between rating and stronger band → unavailable
- missing weaker irrelevant boundaries do not invalidate a stronger proven band

Non-monotonic native thresholds → fail closed (`NON_MONOTONIC_THRESHOLDS` / `NON_MONOTONIC_POLICY`). Remapped cutoffs remain ineligible for LKG unless exact target-season equivalence is proven (Agent 03 rule preserved).

### Persisted v1 migration / reuse
Provider-free upgrade when store-v1 + policy-v1 anchors are the canonical p999/p990/p900/p750/p600 key mappings:
- verify integrity against the **original v1 content hash**
- upgrade in-memory to v2 for scoring
- **no** Raider.IO cutoff refetch solely because scoring representation changed

If upgrade cannot be proven → fail closed / reacquire via existing season-policy lifecycle.

### No-activity / contradiction (unchanged from Agent 03)
- 0/null + `PROVEN_NONE` → `CONFIRMED_NO_ACTIVITY` → standing 0
- 0 + `PROVEN_ACTIVITY` → contradictory / unavailable
- 0/null + `UNKNOWN` → unavailable
- provider failure → unavailable (never standing 25 or 0)

### Diagnostics / provenance
`ExperiencePhase1Result.standingProvenance` + worker diagnostics expose:
- historical rating
- rating source (`BLIZZARD` | `RAIDERIO_FALLBACK`; cache hit keeps original source in provenance; diagnostics may say `PERSISTED`)
- exact historical season slug
- population policy version
- matched native band
- thresholds used
- previousStandingScore / classRankFloor / eliteFloor / final score / confidence causes

No frontend work.

### Cold / warm / replay provider call counts
| Path | Blizzard rating | Achievements | Dedicated RIO historical | RIO cutoffs | WCL Experience |
|------|-----------------|--------------|--------------------------|-------------|----------------|
| Cold miss + Blizzard OK | 1 | 1 | 0 | 0 (season LKG) | 0 |
| Cold miss + Blizzard fail + dedicated RIO | 1 | 1 | 1 | 0 | 0 |
| Warm / replay after success | 0 | 0 | 0 | 0 | 0 |

Identical native-band Experience score on warm/replay when persisted rating + compatible policy are reused.

### Confidence
Resolved evidence (including confirmed absence) → confidence `1`. Unavailable/contradiction → `null` + causes. No fractional confidence for broad native bands.

## Files changed (Agent 04)
- `packages/scoring/src/experience/phase1/season-population-policy.ts` (+ tests)
- `packages/scoring/src/experience/phase1/calculate.ts` (+ tests)
- `packages/scoring/src/index.ts`
- `apps/worker/.../experience-season-population-policy-metadata.ts` (+ tests)
- `apps/worker/.../experience-phase1.ts` (+ tests / e2e / live smoke)
- `apps/worker/.../experience-evidence-persist.test.ts`
- `apps/worker/.../experience-season-population-policy-sync.test.ts`
- orchestration handoff

## Tests run
Scoring phase1 policy + calculate, worker metadata/sync/phase1/persist/e2e/bootstrap/score-character — **all passed** (126 focused tests across those files).

## Blockers / questions for Agent 05
1. End-to-end rollover acceptance (Agent 05 prompt).
2. Class-rank floor still unavailable without exact-season rank source.
3. Deploy migration `20260809180000_character_experience_evidence` if not yet applied.
4. Optional: rewrite store-v1 Season.metadata documents to store-v2 on next successful sync (reader already upgrades).
5. Do **not** change P/S/U formulas.

## Baseline
Preserve P/S/U baseline in `AUDIT_BASELINE.md`.

## Start instruction for Agent 05
Read this handoff + `PRODUCT_DECISIONS.md`. Execute end-to-end rollover acceptance only. Do not reopen Agents 01–04 unless a regression is proven.
