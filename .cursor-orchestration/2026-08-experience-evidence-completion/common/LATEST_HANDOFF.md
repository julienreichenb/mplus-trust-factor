# Latest Handoff

## Step
Pre-implementation product handoff.

## Product decisions locked
See `PRODUCT_DECISIONS.md`.

Key points:
- Blizzard first, Raider.IO exceptional fallback for historical rating.
- Successful closed-season historical rating is acquired once and persisted permanently.
- Current season must remain dynamic and use canonical season authority.
- Previous season means immediately preceding real Mythic+ season, including cross-expansion.
- Raider.IO event/intermediate periods must never replace the real previous season.
- Regional class rank must be for the exact previous real season.
- Standing should use Raider.IO native cutoff bands; no second invented percentile grid / unsupported extrapolation.
- rating 0/null + proven no activity => E=0 available.
- Experience evidence must support provider-free replay.
- Frontend explainability is out of scope.

## Baseline
Previous scoring audit is merge-ready/CI green. Preserve P/S/U baseline documented in `AUDIT_BASELINE.md`.

## Start instruction
Agent 01 must audit before implementing. It must not assume the current `previous` Raider.IO shorthand is correct.
