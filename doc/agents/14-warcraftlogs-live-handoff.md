# Agent 14 — Warcraft Logs public live provider handoff

## Branch / worktree

- Worktree: `14-warcraftlogs-live`
- Branch: `agent/wave3-warcraftlogs`

## Commit

`de69b082e1dd5db246b43006887c0e73e6d02c78`

## Summary

Hardened `@mplus/provider-warcraftlogs` for Wave 3 public live use:

- OAuth client-credentials + `/api/v2/client` only (no user OAuth / private API).
- `ProviderFetchContext.targetCharacter` required for fight analysis (no `WCL_DEFAULT_*` / Fixtureplayer fallbacks).
- Explicit M+ zone config (`WCL_MPLUS_ZONE_ID` / constructor) with expiry alarm; expired zones skip rankings.
- Bounded discovery: 1 rankings query (when valid), 1 recentReports page (`limit=20`), candidate cap 25.
- Never probes private/unlisted reports; never sets `allowUnlisted`.
- Visibility: `PUBLIC` | `HIDDEN` | `NO_PUBLIC_LOGS` | `PRIVATE_SKIPPED` | `UNAVAILABLE` | `RATE_LIMITED`.
- Optimistic placeholders removed: no `timed=true`, no claimed `current` season/dungeon; incompleteness + match confidence modeled.
- Event ingestion bounds (10 pages / 2000 events / type) with rate-budget gating mid-fetch.
- Actor resolution fails safely on ambiguity.
- Migration-ready CR for `RunCombatFacts` → `@mplus/contracts` (shared files not edited).

## Tests executed

- `pnpm test -- packages/providers/warcraftlogs/src/warcraftlogs.test.ts` — **32 passed**
- `pnpm --filter @mplus/provider-warcraftlogs run typecheck` — **pass** (after building contracts/domain/config)

## Live API calls

- `pnpm wcl:smoke` — **SKIP** when credentials / `PROVIDER_MODE=live` absent (no CI live calls).

## Remaining blockers

1. Agent 11: formalize `WCL_MPLUS_ZONE_ID` + `WCL_MPLUS_ZONE_EXPIRES_AT` in `@mplus/config`.
2. Agent 15: apply CR-14 (`doc/contracts/change-requests/14-warcraftlogs-run-combat-facts.md`); wire character-level WCL state when there are zero runs; season-aware dungeon/zone maps.
3. Live smoke against a real public EU character once credentials + zone ID are configured.
4. API profile `WclVisibilityState` in contracts still lacks `UNAVAILABLE` / `RATE_LIMITED` until CR applied.

## Files changed (owned)

- `packages/providers/warcraftlogs/**`
- `tools/fixtures/warcraftlogs/**` (archived, private-skipped, ambiguous-actor)
- `doc/research/providers/warcraftlogs-live-api.md`
- `doc/contracts/change-requests/14-warcraftlogs-run-combat-facts.md`
- `doc/api/warcraftlogs/*` (bounds/visibility docs)
- `doc/agents/14-warcraftlogs-live-handoff.md`
