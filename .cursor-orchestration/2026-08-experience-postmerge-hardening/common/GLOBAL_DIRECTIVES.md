# Global Directives

These rules apply to every agent in this chantier.

## Repository / workflow

- Stay in the current worktree and current branch.
- Do not create another branch.
- Do not create another worktree.
- Do not switch branches.
- Keep each agent's changes limited to its prompt.
- Update `common/LATEST_HANDOFF.md`.
- Commit completed work before stopping.

## Product invariants

The validated P/S/U pipeline from PR #83 is production-critical.

Do not change:
- run selection semantics;
- WCL evidence acquisition;
- P/S/U formulas;
- P/S/U confidence formulas;
- Trust dimension weights;
- grade thresholds;
- Experience native band scores;
- class-rank floors;
- elite floor.

`0` is a valid calculated Experience score only when no previous-season activity is proven.

Provider/config/integrity failure is unavailable, never fabricated `0` or `25`.

## Experience authority

- Current season authority remains Blizzard `season_index.current_season`.
- Previous real Mythic+ season remains chronology-based, never `seasonId - 1`.
- Raider.IO event/intermediate seasons must not become product previous season.
- Do not trust generic Raider.IO `previous` aliases without exact-season binding.
- Do not trust generic `previous_mythic_plus_ranks` without exact-season provenance.
- Blizzard remains primary historical-rating source.
- Raider.IO is exceptional exact-season fallback.
- Closed-season successful evidence is immutable and provider-free after acquisition.
- Transient failures are not immutable facts.

## Architecture

Prefer one canonical resolver over duplicate query logic.

If the caller and callee independently infer "previous season", remove the duplication and pass or derive from the canonical result.

Persisted evidence must be compatible with the exact character + exact internal Season + Blizzard season id + Raider.IO season binding + compatibility version.

A malformed/mismatched immutable row must fail closed and be reacquired when providers are permitted.

## Validation

Every behavioral fix needs a regression test that fails on PR #84 behavior and passes after the fix.

Synthetic rollover tests must use invented IDs/slugs.

Agent 03 must exercise the canonical production-facing scoring entry, not only `buildExperiencePhase1Result()` directly.
