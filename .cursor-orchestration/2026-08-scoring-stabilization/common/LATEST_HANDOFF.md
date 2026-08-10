# LATEST HANDOFF — Agent 03B (Blizzard character M+ history)

**Branch:** `fix/scoring-stabilization`  
**Status:** Historical character Blizzard dataset: **FIXED IN CODE / READY FOR 03C**.

Do **not** claim the Experience UI bug is fixed — Agent 03C has not reworked Experience calculation yet.  
Do **not** start Agent 04.

## Delivered

1. Live-proven Blizzard Profile Index + Season Details shapes (canary: Lfgmasochist / EU / ysondre)
2. Generic closed-season historical acquisition: Profile Index → map Blizzard season ids → Season Details only for missing closed seasons → immutable `PREVIOUS_SEASON_RATING` evidence
3. Warm completeness: when all known closed real Blizzard seasons (`blizzardSeasonId` 1–999) have terminal evidence → **0** historical Blizzard calls
4. Current/open season excluded from immutable historical evidence
5. `HistoricalSeasonRating` dataset + join helper for 03A population policy (no Experience formula change)
6. No migration; reuses existing Experience evidence infrastructure
7. Zero Raider.IO character calls on this path

## Live canary (Lfgmasochist)

- Profile Index seasons: `[14, 11, 15, 13, 10, 9, 17]` (includes current 17)
- Cold (after rebuild of `@mplus/provider-blizzard` dist): 1 index + 6 Season Details; HAS_VALUE for 9–11, 13–15
- Warm: 0 index / 0 details
- Join proof `season` blizzard 15 (TWW3): rating **3862.6304** with catalog cutoffs p999=3946.97 … p600=2558.75 (unchanged)

## Semantics decision (absence)

After a **successful** Profile Index: closed internal seasons absent from `seasons[]` → `CONFIRMED_NO_ACTIVITY` (Season Details for those ids → 404).  
Index failure → leave seasons UNKNOWN/retryable (do not invent absence).

## Note for operators

`@mplus/provider-blizzard` source already maps Season Details `mythic_rating`; ensure **dist is rebuilt** before live runs (`pnpm --filter @mplus/provider-blizzard build`) or ratings normalize to null → CONTRADICTORY_PAYLOAD.

## Next

**Agent 03C** — Experience calculation using Blizzard history + 03A population context.  
Do not alter 03A cutoff catalog values.
