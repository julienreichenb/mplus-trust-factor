# Agent 10 — Wave 2 frontend completion

**Branch:** `integration/wave2`  
**Date:** 2026-07-27  
**Scope:** Close remaining MVP integration gaps (frontend, E2E, WCL identity).

## Summary

Restored the full Vue SPA from `integration/wave1`, aligned the live API client with current routes/DTOs, exposed `wclVisibility` on character profiles, fixed WCL actor resolution to use refresh identity via `ProviderFetchContext.targetCharacter`, and added Playwright E2E covering search → refresh → score → profile → compare → addon export.

## Frontend (`apps/web`)

| Area | Change |
|------|--------|
| Pages | Restored `HomePage`, `CharacterPage`, `ComparePage`, `AdminModelsPage` (non-stub) |
| API client | Mock/live factory; `refreshCharacter` omits body when empty |
| Realm autocomplete | Human label + canonical slug; mouse/keyboard selection preserved |
| Profile UI | Dimensions, authenticity, red flags, runs, equipment, Raider.IO attribution, WCL visibility banner |
| Compare | Candidates can be added one-by-one; compare submit requires ≥2 |
| States | Queued/stale/not-found/low-confidence banners |
| Modes | `VITE_API_MODE=mock` (default) and `live` both supported |

## API (`apps/api`)

- `CharacterProfileResponse.wclVisibility` from latest `RunAnalysis.summary`
- `GET /metrics` restored for observability
- E2E fixture API on `:3099` with inline worker

## Worker / providers

- `ProviderFetchContext.targetCharacter` set in refresh pipeline
- WCL live + fixture `getReportFightDetails` resolve actors from context
- `wcl-visibility-v1` persisted when no combat facts are available
- `WCL_DEFAULT_*` retained only as smoke-tooling fallback

## E2E (`apps/web/e2e`)

| Project | Tests | Servers |
|---------|-------|---------|
| `mock` | `smoke.spec.ts` (5) | `serve-preview.ts` → `dist-mock` on `:4173` |
| `fixture-live` | `fixture-pipeline.spec.ts` (1) | `serve-fixture-live.ts` → API `:3099`, `dist-e2e-live` on `:4199` |

- Global setup starts supervisors, waits for `E2E preview ready`, kills ports on teardown
- Separate `dist-mock` / `dist-e2e-live` outputs prevent build clobbering
- Requires PostgreSQL on `:5433` for the fixture-live project

## Commands

```bash
pnpm lint && pnpm typecheck && pnpm test
pnpm test:integration && pnpm test:contract
pnpm test:e2e          # Playwright (mock + fixture-live)
pnpm build && pnpm openapi:generate && pnpm addon:export
```

## Known follow-ups

- Live WCL smoke still uses `WCL_SMOKE_*` env vars (intentional)
- Raider.IO commercial review before public launch
- Vue live mode against production API requires CORS + credentials configuration
