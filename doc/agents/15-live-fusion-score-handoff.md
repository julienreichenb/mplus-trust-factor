# Agent 15 — Live source fusion, refresh DAG and score handoff

- ID: 15
- Scope: Live source fusion, refresh DAG, score inputs, CR-14 / Raider.IO contract reconcile
- Branch: `agent/wave3-live-fusion`
- Worktree: `15-live-fusion`
- Date: 2026-07-27

## Summary

Implemented Wave 3 live fusion on top of `integration/wave3`:

- Applied **CR-14**: shared `WclVisibilityState` (incl. `UNAVAILABLE` | `RATE_LIMITED`) + persistable `RunCombatFacts` coverage DTOs in `@mplus/contracts`; WCL package re-exports contract types.
- Reconciled **Raider.IO additive contracts** (`gear`, `talents`, `crawlStale`); season-cutoffs stay optional/non-blocking on upstream 500.
- Replaced fake `performance.spec_percentile = mythicRating / 3200` with `performance.mythic_rating` (season-cutoff normalization when available; transparent low-confidence heuristic otherwise). Raider.IO score kept as separate `source.raiderio_score` observation (not product score).
- Refresh DAG: Blizzard identity gate → concurrent Raider.IO/WCL enrichment → reconcile/fuse runs → metrics → blocking structural score validation → persist.
- Soft-skips Raider.IO/WCL enrichment failures so MVP still returns a Blizzard-backed score.
- Persists character-level `CharacterProviderState` even when no runs exist; records disagreements / excluded low-confidence near-miss matches.
- Structural `validateScoreSnapshot` failures **block** persistence.

## Commit

See `git log` on `agent/wave3-live-fusion` (this handoff commit).

## Tests executed

```text
pnpm --filter @mplus/contracts build
pnpm --filter @mplus/database exec prisma generate
pnpm --filter @mplus/database exec prisma migrate deploy
pnpm --filter @mplus/scoring build
pnpm --filter @mplus/test-utils build
pnpm --filter @mplus/worker typecheck
→ pass

pnpm exec vitest run apps/worker/src/refresh-pipeline.test.ts apps/worker/src/orchestration packages/scoring
→ pass (refresh matrix + fusion unit + scoring)
```

No live provider calls in automated tests.

## Integration findings applied

| Finding | Handling |
|---------|----------|
| Blizzard live smoke OK (EU/archimonde/Wallidrixe) | Identity gate unchanged; equipment null ilvl tolerated upstream |
| Blizzard equipment may return null item level | Snapshot records nullable ilvl; no fabricate |
| Raider.IO season-cutoffs HTTP 500 | Non-blocking; capability warning `RAIDERIO_SEASON_CUTOFFS_UNAVAILABLE`; heuristic rating path |
| Raider.IO profile/static/run-details OK | Consumed in fusion |
| WCL auth/rateLimit/character/recent reports OK | Consumed; zone rankings remain optional until `WCL_MPLUS_ZONE_ID` |
| MVP score when RIO/WCL unavailable | Soft-skip enrichment; Blizzard-backed provisional score |

## Acceptance mapping

| Criterion | Status |
|-----------|--------|
| Target DAG + concurrent RIO/WCL after Blizzard | done |
| Character-level provider states without runs | done (`character_provider_states`) |
| Reconcile + disagreements | done |
| Blizzard season + RIO runs fused; WCL near-miss excluded | done (heuristic near-miss window) |
| Replace `/3200` fake percentile | done (`performance.mythic_rating`) |
| RIO score ≠ product score | done |
| Outage ≠ player penalty / soft-skip enrichment | done |
| Structural validate blocks persist | done |
| Dedupe + negative cache | preserved |
| Explanation includes model/observations/providers/warnings | done |
| Fixture tests: all providers / RIO down / WCL disabled / NOT_FOUND / invalid snapshot / dedupe | done |

## Remaining for Agents 16–20

1. API/UI surface for `providerStates`, disagreements, honest null ilvl, cutoffs-unavailable warnings.
2. Durable Raider.IO cache injection (still in-memory by default).
3. Wire `WCL_MPLUS_ZONE_ID` for optional zone rankings.
4. Broader live smoke + Agent 17 QA/security.

## Files changed (owned)

- `packages/contracts/**` (warcraftlogs, fusion, api, provider)
- `packages/database/prisma/**` (`CharacterProviderState` migration)
- `packages/scoring/src/model/defaults.ts`
- `packages/test-utils/src/data-quality.ts`
- `packages/providers/warcraftlogs/src/types.ts`
- `apps/worker/src/orchestration/**`
- `apps/worker/src/persistence/provider-state-repository.ts`
- `apps/worker/src/refresh-pipeline.test.ts`
- `doc/contracts/change-requests/13-*.md`, `14-*.md`
- `doc/agents/15-live-fusion-score-handoff.md`
