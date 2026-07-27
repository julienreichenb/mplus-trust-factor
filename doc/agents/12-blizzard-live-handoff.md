# Agent 12 — Blizzard live provider hardening handoff

## Branch / worktree

- Worktree: `C:/Users/julie/VS Projects/mplus-agents/12-blizzard-live`
- Branch: `agent/wave3-blizzard` (brief listed `agent/w3-blizzard-live`; used existing Wave 3 worktree branch)

## Commit

- `fbebcfc3e01b97e33c8901ab2932b402720c595d` — provider hardening (primary)
- `6d9a40efb64d9ce21a861d65261d7a6017c92706` — handoff finalize (HEAD)

## Summary

Hardened `@mplus/provider-blizzard` for Wave 3 live MVP:

- Revalidated EU/US/KR/TW hosts, namespaces, locales; China unsupported.
- Fixed media path to official `/character-media` (contract-tested).
- Added dynamic current season/period resolution and current-season best-run helper.
- Distinguished error reasons: `INVALID_REQUEST`, `NOT_FOUND`, `PROFILE_UNAVAILABLE`, rate-limit, timeout, transient.
- Token single-flight cache; HTTP timeout; capped retries with jitter; `Retry-After` delta-seconds + HTTP-date; negative cache for stable 404/400.
- Observation envelopes + provenance without secrets/Authorization.
- Expanded fixture/contract coverage and allowlisted live smoke hook (`pnpm blizzard:smoke` / package `smoke:live`).
- Updated `doc/research/providers/blizzard-live-api.md`.

## Files changed

- `packages/providers/blizzard/**`
- `tools/fixtures/blizzard/**` (period fixtures, 400/403 errors, manifest)
- `doc/research/providers/blizzard-live-api.md`
- `doc/api/blizzard/README.md`
- `doc/agents/12-blizzard-live-handoff.md`
- `package.json` (`blizzard:smoke` hook)

## Tests executed

- `pnpm exec vitest run packages/providers/blizzard/src/blizzard.test.ts` — **30 passed**
- `pnpm --filter @mplus/provider-blizzard typecheck` — pass
- `pnpm --filter @mplus/provider-blizzard build` — pass

## Live API calls performed

- **None.** No `BLIZZARD_CLIENT_ID` / `BLIZZARD_CLIENT_SECRET` in this environment.
- `pnpm --filter @mplus/provider-blizzard smoke:live` → `SKIP live smoke: Blizzard credentials unavailable`.

## Remaining blockers

1. Run allowlisted live smoke when credentials exist:
   ```bash
   set BLIZZARD_CLIENT_ID=...
   set BLIZZARD_CLIENT_SECRET=...
   set BLIZZARD_SMOKE_CHARACTER=<exact-name>
   set BLIZZARD_SMOKE_REALM=tarren-mill
   set BLIZZARD_SMOKE_REGION=EU
   pnpm blizzard:smoke
   ```
2. Period helpers are package-local extras (not on shared `BlizzardProvider` interface); Agent 15 may open a contracts CR if needed.
3. Character-profile 404 remains ambiguous at the HTTP layer; UI/DAG must honor `details.reason=PROFILE_UNAVAILABLE` and avoid claiming non-existence.
4. Score percentile misuse (`rating/3200`) is owned by Agent 15, not this package.

## Acceptance checklist

| Item | Status |
|---|---|
| Fixture/recorded tests: success, privacy/404, 429, malformed, token refresh | Done |
| Manual allowlisted smoke retrieves identity/equipment/media/current M+ | Hook ready; not run (no credentials) |
| No live external requests in CI | Done |
| Handoff written + committed | Done |
