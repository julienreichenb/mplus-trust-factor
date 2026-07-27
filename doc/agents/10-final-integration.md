# Agent
- ID: 10
- Scope: Final integration, MVP acceptance, release readiness
- Branch/worktree: master (integration)
- Date: 2026-07-27
- Commit(s): pending user commit

# Summary
Integrated Agents 0–6 into a fixture-mode MVP: wired `@mplus/scoring` and Blizzard provider factory (`PROVIDER_MODE`), applied profile enrichment CR-06, fixed web live API client paths, added admin clone/update routes, implemented addon Lua export, added CI workflow and release documentation.

# Plan reference
[doc/plans/10-final-integration.md](../plans/10-final-integration.md)

# Files owned/changed
- `apps/worker/src/providers/provider-factory.ts`, `container.ts`, `generate-addon-export.ts`, `score-repository.ts`, `run-repository.ts`
- `apps/api/src/services/character-service.ts`, `admin-service.ts`, `lib/mappers.ts`, `lib/profile-enrichment.ts`, routes
- `apps/web/src/api/live-client.ts`, `types.ts`, `mock/client.ts`, composables, `CharacterPage.vue`
- `packages/contracts/src/api.ts`
- `tools/addon-exporter/**`, `addon/MPlusTrust/core.lua`
- `.github/workflows/ci.yml`, `doc/release/**`, `package.json`, `vitest.config.ts`

# Public contracts
- Extended `CharacterProfileResponse` with optional enrichment fields (CR-06 applied)
- Realms route accepts `q` alias for `query`
- Admin: `POST /admin/score-models/:id/clone`, `PUT /admin/score-models/:id`
- redFlags persisted inside snapshot `explanation` JSON and mapped on read

# Acceptance results
| Command | Result |
|---------|--------|
| `pnpm install` | ok |
| `pnpm db:generate` | ok |
| `pnpm lint` | pass |
| `pnpm typecheck` | pass |
| `pnpm test` | pass |
| `pnpm test:integration` | pass |
| `pnpm test:e2e` | pass (mock) |
| `pnpm build` | pass |
| `pnpm openapi:generate` | writes `apps/api/openapi.json` |
| `pnpm compose:up` | postgres+redis healthy |
| `pnpm addon:export` | writes Lua shard |

# External API observations
- Live smoke skipped without credentials (`PROVIDER_MODE=fixture`)
- Blizzard package fixture + worker fallback composite for arbitrary test identities

# Security and privacy
- Addon export contains grade/score/confidence only (no secrets, no raw payloads)
- `PUBLIC_DETAILS_ALL` gates serializer fields
- CI uses test secrets only

# Known limitations
- WCL/RIO live packages still stub; worker fixtures used
- Raider.IO commercial review required before public launch
- Boost dispute mechanism not built
- Web e2e remains mock-mode; live stack manual verification

# Contract change requests
- CR-06 profile enrichment — **applied**
- CR-06 realms autocomplete — **applied** (`q` alias)
- CR-06 admin model ops — **applied** (clone + update)
- CR-04 score-model-config-v1 — deferred (rich config stays in `@mplus/scoring`)

# Follow-up work
- Agent 2/3: live WCL/RIO packages
- Expert calibration of scoring weights
- Redis-backed API cache for multi-instance
- Live-mode Playwright e2e against docker stack

# Rollback
- Revert Agent 10 commit
- Set `PROVIDER_MODE=fixture`
- See [doc/release/rollback-checklist.md](../release/rollback-checklist.md)
