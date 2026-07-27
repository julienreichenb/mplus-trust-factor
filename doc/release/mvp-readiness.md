# MVP readiness report

**Date:** 2026-07-27  
**Agent:** 10 (final integration)

## Status: Fixture-mode MVP ready

The monorepo supports a full local fixture-mode flow:

```bash
pnpm install
cp .env.example .env
pnpm compose:up          # or pnpm dev:infra
pnpm db:generate && pnpm db:migrate && pnpm db:seed
pnpm dev                 # loads .env automatically
```

- API: http://localhost:3000/docs  
- Web: http://localhost:5173 (`VITE_API_MODE=mock` default; set `live` for real API)

## Integrated components

| Layer | Status |
|-------|--------|
| Scoring engine (`@mplus/scoring`) | Wired in worker refresh + recalculate |
| Blizzard provider | Wired via `PROVIDER_MODE` + composite fixture fallback |
| WCL / Raider.IO | Worker fixture adapters (live packages stub) |
| API profile enrichment | Applied (CR-06) |
| Frontend live client | Path-aligned with OpenAPI routes |
| Addon Lua export | CLI + worker job writes `addon/MPlusTrust/Data/MPlusTrustData.lua` |
| CI | GitHub Actions `ci.yml` |

## Not commercially ready

- Raider.IO acceptable-use / commercial restrictions — contact Raider.IO before competing launch
- Boost/red-flag dispute mechanism not implemented
- Live WCL/RIO provider packages incomplete
- Scoring weights are v1 hypotheses, not expert-calibrated

## Live smoke (optional)

Set credentials in `.env` and `PROVIDER_MODE=live`, then:

```bash
pnpm --filter @mplus/provider-blizzard smoke:live
```

Bounded single-character smoke only; no bulk provider calls.
