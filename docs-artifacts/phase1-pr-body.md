## Summary

- Harden Phase 1 CharacterPage media ladder and score-await UX without expanding into later backlog.
- Public score **Retry** only re-reads profile/refresh-status and restarts bounded polling; it never calls admin-only `POST /characters/.../refresh`.
- Unify polling on `useCharacterScoreAwait` / `useRefreshPolling` (single lifecycle, no dual loops; continues while hidden so publication cannot stall; stops on terminal status/timeout/unmount).
- Offline-resilient final media fallback: CSS class-coloured identity monogram (optional remote class/spec icon is enhancement only). Local `/fixtures/*` SVGs for mock visual QA.

## Test plan

- [x] `pnpm --filter @mplus/web test` — branch tests pass; 5 baseline failures documented on clean `31f1942a`
- [x] Narrow suite: media ladder, score await, refresh polling, score loading panel, CharacterPage retry
- [x] `pnpm --filter @mplus/web typecheck`
- [x] `pnpm --filter @mplus/web build`
- [x] `pnpm check:english`
- [x] `pnpm lint` (0 errors)
- [x] Visual QA screenshots under `docs-artifacts/phase1-visual-qa/` (desktop 1440×900 / mobile 390×844)

## Baseline failures (not caused by this branch)

Proven on clean base `31f1942a` in a temporary worktree:

1. `ScoreHeader.scoreContext.test.ts` — expects `"Show score before key level and meta adjustments"` / `"Key ×…"`, code has `"Show raw score"` / `"Key level ×…"`
2. `externalProfileLinks.test.ts` — expects `warcraftlogs.com` / `blizzard.com`, code has `warcraftlogs` / `blizzard`
3. `PerformanceSummaryPanel.test.ts` — empty `tbody img.dungeon-art`

## Out of scope

No merge, no deploy, no scoring/admin backlog expansion.
