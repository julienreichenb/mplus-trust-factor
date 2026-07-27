# Agent 13 — Raider.IO live character profile handoff

- ID: 13
- Scope: Raider.IO live profile integration
- Branch: `agent/wave3-raiderio`
- Worktree: `13-raiderio-live`
- Date: 2026-07-27

## Summary

Hardened `@mplus/provider-raiderio` for Wave 3 live character profile fetch: Wave 3 field set (gear, talents, current scores, ranks, recent/best runs), nested live payload normalization, crawl-staleness, optional non-blocking season-cutoffs with capability state, versioned expansion resolution (Midnight `11`), run-details region fix, timeout/429/5xx/malformed handling, documented `access_key` query transmission, cache metadata for Agent 15, fixtures + research updates.

## Commit

See git log on `agent/wave3-raiderio` (this handoff commit).

## Tests executed

```text
pnpm exec vitest run packages/providers/raiderio
→ 7 files, 36 tests passed

pnpm --filter @mplus/contracts build
pnpm --filter @mplus/config build
pnpm --filter @mplus/domain build
pnpm --filter @mplus/provider-raiderio typecheck
→ pass

pnpm --filter @mplus/provider-raiderio build
→ pass
```

## Live API calls performed

Manual smoke (no `RAIDERIO_APP_KEY`):

```powershell
$env:ALLOW_LIVE_PROVIDER_CALLS="true"
node packages/providers/raiderio/dist/smoke-live.js
```

Identity: `EU` / `silvermoon` / `Pin`

Observed:

- profile OK (score 1728.3, gear ilvl, ranks, attribution URL, crawlStale=true)
- season-cutoffs HTTP 500 → capability `unavailable`, non-blocking
- static-data expansionId `11` (Midnight) via documented_current resolution
- run-details roster regions `EU` (not hardcoded)

Additional probes during implementation: `/periods`, `/static-data` for ids 9–11, missing-character 400 shape, cutoffs 500 confirmation.

## Files changed (owned)

- `packages/providers/raiderio/**`
- `packages/contracts/src/raiderio.ts` (additive gear/talents/crawlStale DTOs — see change request)
- `tools/fixtures/raiderio/**`
- `tools/fixtures/providers.json`
- `doc/research/providers/raiderio-live-api.md`
- `doc/api/raiderio/*` (matrix, openapi, cache, overview)
- `doc/contracts/change-requests/13-raiderio-live-types.md`
- `doc/agents/13-raiderio-live-handoff.md`

## Acceptance mapping

| Criterion | Status |
|-----------|--------|
| Minimal fields: gear, talents, current scores, ranks, recent/best | done |
| Normalize score/ranks/URL/last_crawled_at/gear/runs + attribution | done |
| Fix `fetchRunDetails` hardcoded EU | done (uses ctx + roster region) |
| Remove unversioned expansion hardcode | done (catalog + probe, pin dated 2026-07-27) |
| season-cutoffs optional + capability | done |
| Cache metadata for Agent 15 | done (`RaiderIoCacheStore`, `describeCacheEntry`) |
| 429 / timeout / transient / malformed | done |
| `RAIDERIO_APP_KEY` only as OpenAPI `access_key` query | done |
| Tests: current, stale crawl, missing optional, 404/400, 429, 5xx, malformed | done |
| Manual smoke without app key | done |
| Legal/commercial gate documented | preserved in research + terms docs |

## Remaining blockers

1. **Persistent cache** — in-memory store remains default; Agent 15 should inject durable `RaiderIoCacheStore` / `ExternalRequest` persistence using exposed fingerprints.
2. **season-cutoffs upstream 500** — still failing live; capability marks unavailable until Raider.IO fixes or alternate source exists.
3. **Agent 11 smoke wiring** — provider-local `smoke-live` exists; root `live:smoke:raiderio` may still need foundation agent wiring.
4. **Contract ownership** — additive DTO fields landed in `packages/contracts/src/raiderio.ts`; Agent 15 should review `doc/contracts/change-requests/13-raiderio-live-types.md`.
5. **Commercial/legal launch gate** — unchanged; public monetized launch still blocked pending Raider.IO terms confirmation.

## Notes for Agent 15

- Profile field string: `gear,talents,mythic_plus_scores_by_season:current,mythic_plus_ranks,mythic_plus_recent_runs,mythic_plus_best_runs`
- Missing characters are live HTTP **400**, normalized to `NOT_FOUND`
- `getSeasonCutoffs()` returns empty thresholds instead of throwing on upstream failure
- `getCapabilities()` / `describeCacheEntry()` are on the concrete provider class
