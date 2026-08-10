# LATEST HANDOFF — Agent 03A (historical Experience population catalog)

**Branch:** `fix/scoring-stabilization`  
**Status:** Historical cutoffs catalog **DONE**. Do **not** start Agent 03B / Agent 04.

## Delivered

1. Explicit `pnpm experience:cutoffs:collect` (Raider.IO → versioned catalog)
2. Tracked catalog: `packages/database/src/seed-data/experience-season-cutoffs.json`
3. `pnpm db:seed` imports catalog into `Season.metadata` population policy (offline, idempotent)
4. No migration; reuses existing Experience population-policy store-v2 shape

## Live collect (this worktree)

- Collected **36** entries (9 closed seasons × 4 regions)
- Seasons: `season-sl-3/4`, `season-df-1..4`, `season-tww-1..3`
- Skipped current: `season-mn-1`, `season-mn-2`
- Older BFA / early SL: closed main seasons discovered but RIO returned no quantile scores → skipped (not failed)
- Cutoff fields: `p999`, `p990`, `p900`, `p750`, `p600` (+ `totalPopulation` when present)

## Manual next (optional)

```bash
pnpm experience:cutoffs:collect
pnpm db:seed
```

Do **not** start Blizzard character-history acquisition (03B) until product gate says so.
