# Agent
- ID: 06
- Scope: Vue 3 MVP website (search, profile, compare, admin) with mock-mode independence
- Branch/worktree: `agent/frontend`
- Date: 2026-07-27
- Commit(s): `befe817`

# Summary
Implemented the full Agent 6 Vue website against `@mplus/contracts`, with a typed **mock API** (`VITE_API_MODE=mock` default) so the app is testable without Agent 5 backend routes. Pages cover search → profile (Trust Factor, grade, radar, dimensions, authenticity, runs, gear, sources), compare (2–10), and admin model draft/validate/backtest/activate. ECharts radar uses fixed 0–100 axes plus an accessible HTML table. No scoring formulas or provider secrets in the browser.

# Plan reference
[doc/plans/06-frontend.md](../plans/06-frontend.md)

# Files owned/changed
- `apps/web/**` — API client + mocks, pages, components, composables, stores, styles, Vitest, Playwright
- `doc/architecture/frontend/**` — routes/state, components, API contract usage, a11y, freemium readiness
- `doc/contracts/change-requests/06-*.md` — profile enrichment, admin ops, realms autocomplete
- `doc/plans/06-frontend.md`, `doc/agents/06-frontend.md`
- Root: `package.json` (`test`/`test:e2e`), `vitest.config.ts` (exclude web), `.gitignore` (Playwright artifacts), lockfile via `pnpm install`

# Public contracts
- Consumes existing `@mplus/contracts` API/scoring/identity DTOs (no package mutation).
- Interim `CharacterProfileView` + admin/realm client methods documented in change requests for Agent 5.
- Env (web): `VITE_API_MODE=mock|live`, `VITE_API_BASE_URL`, `VITE_ADMIN_API_KEY` (live admin only).

# Acceptance results
Exact commands run:

| Command | Result |
|---------|--------|
| `pnpm install` | ok |
| `pnpm lint` | pass |
| `pnpm --filter @mplus/web typecheck` | pass |
| `pnpm test` (root unit + web Vitest) | pass (8 + 18; 3 scoring todos unrelated) |
| `pnpm --filter @mplus/web build` | pass |
| `pnpm test:e2e` (Playwright smoke) | **5/5 pass** |

Note: recursive `pnpm typecheck` can fail on `apps/api` / `apps/worker` when dependent package `dist/` is missing (foundation project-references quirk). Not introduced by Agent 6; web typecheck/build are green.

# External API observations
- No browser calls to Blizzard / WCL / Raider.IO.
- Mock fixtures include Raider.IO attribution only when `raiderIoUsed` is true.
- Live client paths are ready for Agent 5 OpenAPI once routes land.

# Security and privacy
- No provider secrets in the SPA.
- Admin key only for live mode header; mock mode unlocks admin UI locally.
- Fixture characters are sanitized placeholders.

# Known limitations
- Profile enrichments are frontend view types until Agent 5 adopts CRs.
- Mechanic-rule admin page deferred (documented follow-up).
- ECharts canvas skipped under Vitest (`MODE=test`); a11y table always present.
- Entitlements unlock everything at launch; locked rendering is wired but unused in fixtures.

# Contract change requests
- `doc/contracts/change-requests/06-profile-enrichment.md`
- `doc/contracts/change-requests/06-admin-model-ops.md`
- `doc/contracts/change-requests/06-realms-autocomplete.md`

# Follow-up work
- Agent 5: implement search/profile/compare/refresh/admin/realms routes matching CRs.
- Wire live mode in integration (Agent 10) and drop mock-only reliance for staging.
- Optional: nested metric editors for all dimensions (performance nested weights shipped).

# Rollback
- Revert the Agent 6 commit(s) on `agent/frontend`, or disable by not deploying `apps/web`.
- Mock mode has no server side effects.
