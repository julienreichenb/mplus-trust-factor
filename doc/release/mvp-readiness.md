# MVP readiness — Wave 2

**Status:** Fixture-mode MVP integrated on `integration/wave2`.

## Ready
- Worker refresh DAG with Blizzard + WCL + Raider.IO (fixture/live via `PROVIDER_MODE`)
- Provider disable flags (`disabledProviders`, `RAIDERIO_ENABLED`)
- Scoring engine v1 with authenticity from Raider.IO boost facts
- API routes for search/profile/compare/admin (wave1)
- Addon export from persisted snapshots + standalone fixture CLI
- QA contract/data-quality/security test suites
- Prometheus `/metrics`

## Not ready for commercial launch
- Raider.IO acceptable-use review outstanding
- Live provider smoke not run in CI
- Frontend uses stub pages (API client not fully wired to restored routes)
- WCL live detailed analysis uses default character env for actor resolution

## Local fixture MVP
1. `pnpm dev:infra`
2. `pnpm db:migrate` && `pnpm db:seed`
3. `pnpm dev` (api + worker + web)
4. Enqueue refresh via API or run worker integration tests
