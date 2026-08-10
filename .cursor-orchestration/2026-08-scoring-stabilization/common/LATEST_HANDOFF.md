# LATEST HANDOFF — Agent 03C (historical Experience scoring)

**Branch:** `fix/scoring-stabilization`  
**Status:** Historical Experience scoring **FIXED IN CODE** — awaiting **manual UI gate** (Lfgmasochist refresh).

Do **not** start Agent 04 until the UI gate passes.

## Formula (deterministic baseline)

```
historicalStandingScore = MAX(contextualized closed-season native-band scores)
Experience = MAX(historicalStandingScore, classRankFloor, eliteTitleFloor)
```

Locked bands (exact season cutoffs; no interpolation):  
p999→100, p990→90, p900→75, p750→60, p600→45, below p600→25.

Unsupported seasons (rating known, no COMPLETE same-region 03A policy): retained, not scored, not treated as weakness.

## Acquisition

- **03B** is the sole Blizzard historical-rating path (Profile Index ×1 + missing Season Details).
- Phase1 **no longer** calls Season Details or RIO `mythic_plus_scores_by_season` for standing.
- Elite achievements path unchanged.

## Live canary (Lfgmasochist / EU / ysondre)

| Season | Blizzard id | Rating | Band | Score | Counted |
|--------|-------------|--------|------|-------|---------|
| DF1 | 9 | 3144.55 | p900 | 75 | yes |
| DF2 | 10 | 3007.93 | p990 | 90 | yes |
| DF3 | 11 | 2720.56 | p750 | 60 | yes |
| TWW1 | 13 | 3286.23 | p990 | 90 | yes |
| TWW2 | 14 | 3726.96 | p990 | 90 | yes |
| TWW3 | 15 | 3862.63 | p990 | 90 | yes |

**Winning:** TWW3 / 3862.63 / p990 → **historicalStandingScore = 90** → **Experience = 90** (elite 0, no class-rank).

Warm: Profile Index ×1, Season Details ×0.  
Provider-free replay: Blizzard/RIO/WCL ×0.

## Remaining per-character Raider.IO

- Historical standing: **zero** RIO character-rating calls.
- Optional class-rank proof still *can* use an already-fetched RIO profile when `exactSeasonProven` (refresh-bridge currently passes `false` → class-rank off). **Not expanded in 03C.**

## UI gate (human)

Refresh Lfgmasochist:

- Experience available (not PREVIOUS_EVIDENCE_UNAVAILABLE)
- Explanation references historical standing / winning season
- Score matches diagnostic (~90)
- P/S/U unchanged
