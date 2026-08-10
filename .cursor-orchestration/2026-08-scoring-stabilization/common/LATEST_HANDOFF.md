# LATEST HANDOFF — Agent 03 (Experience previous-season acquisition)

**Branch:** `fix/scoring-stabilization`  
**Status:** Experience issue **FIXED IN CODE** — **PENDING MANUAL UI VALIDATION**. Do **not** start Agent 04.

## Problem

Generic previous-season Experience acquisition failed for characters with real prior-season M+ activity (canary: Lfgmasochist):

- `experience: null` / `PREVIOUS_EVIDENCE_UNAVAILABLE`
- no immutable `PREVIOUS_SEASON_RATING` evidence row
- previous season population policy was already COMPLETE (not the cause)

## Exact root cause

Blizzard **season-details** responses expose rating as `mythic_rating`. Production mapped only index-shaped `current_mythic_rating`.

Effect for a character who played the previous season:

1. Blizzard returns 200 with `mythic_rating` (+ often `best_runs`)
2. Normalizer read rating as **null**
3. Mapper treated payload as `CONTRADICTORY_PAYLOAD` / `NULL_RATING_WITH_RUNS`
4. Exact-season RIO fallback runs only on Blizzard `PROVIDER_FAILURE` (e.g. 404) — **not** on CONTRADICTORY
5. Nothing persisted → calculator `PREVIOUS_EVIDENCE_UNAVAILABLE`

Wallidrixe worked because true Blizzard 404 → RIO fallback → confirmed absence.

## Exact fix (generic)

1. Accept and prefer `mythic_rating` on season-profile schema/normalize (`pickSeasonProfileMythicRating`).
2. Live + fixture providers map that field into the existing profile rating path.
3. `NO_USABLE_POLICY` is **no longer** ensure-complete (policy can land later → retryable).
4. Tiny diagnostics: persist `diagnostics.previousReason` as `standingProvenance.acquisitionReason`.

No character hardcoding. No formula/threshold changes. No new evidence state machine.

## Production LOC

~26 net (`+34 / -8`) across Blizzard provider + Experience bootstrap/phase1 + provenance type.

## Live diagnostic (this worktree)

Provider-free diagnose **not run** — worktree has no `.env` (`DATABASE_URL` etc. missing). Manual UI gate uses the user’s normal local stack.

## Manual UI gate (Experience)

Primary canary — **Lfgmasochist** (fresh refresh):

1. Restart local API / worker / web (so Blizzard provider build is loaded).
2. Open Lfgmasochist → refresh.
3. Expect: Experience **AVAILABLE** (not “Previous-season evidence unavailable”).
4. Expect: historical previous-season evidence used; score matches existing Experience formula (not forced 0).

Optional no-activity canary (if easy):

- Confirmed no previous-season activity → Experience **= 0**, **available** (not error).

Do **not** start Agent 04 until this UI gate passes.
