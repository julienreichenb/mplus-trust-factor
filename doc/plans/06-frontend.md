# Agent 6 — Vue Website Plan

## Current state

- Branch: `agent/frontend` (from Agent 0 foundation `ff28bb0`).
- `apps/web` is a Vue 3 + Vite + Router + Pinia shell with placeholder pages and `fetchMeta` only.
- Shared `@mplus/contracts` API DTOs cover search/profile/compare/refresh/admin/meta envelopes.
- Agent 5 domain routes are **not** implemented yet (`apps/api` = health + meta only).
- No Playwright, no ECharts, no frontend fixtures beyond the shell.

## Ownership

| Own | Do not touch |
|-----|----------------|
| `apps/web/**` | `apps/api/**`, `apps/worker/**` |
| `doc/architecture/frontend/**` | Provider packages, scoring formulas |
| `doc/agents/06-frontend.md`, this plan | Prisma / shared contracts (except CR docs) |
| Frontend mock fixtures under `apps/web` | Live provider secrets |

## Assumption: independent mock mode

Because Agent 5 routes are absent, the web app ships with **`VITE_API_MODE=mock` (default)** using typed fixtures aligned with `@mplus/contracts` plus documented **view enrichments**. Live mode (`VITE_API_MODE=live`) calls `VITE_API_BASE_URL`. The site is fully testable without API/worker/DB.

## Contract gaps → change requests

`CharacterProfileResponse` lacks class/spec/role/ilvl, run summaries, equipment/talents, season history, and entitlements. Frontend will use a local `CharacterProfileView` that embeds contract DTOs and adds those fields. Documented in:

- `doc/contracts/change-requests/06-profile-enrichment.md`
- `doc/contracts/change-requests/06-admin-model-ops.md`
- `doc/contracts/change-requests/06-realms-autocomplete.md`

No silent mutation of `packages/contracts`.

## Route / page map

| Route | Page | Purpose |
|-------|------|---------|
| `/` | Home | Region (EU default), realm autocomplete, name, recent searches, validate → canonical character URL |
| `/character/:region/:realm/:name` | Profile | Trust Factor, grade, radar, dimensions, authenticity, runs, gear, sources, refresh |
| `/compare` | Compare | 2–10 characters, one compare request, radar overlay, table, deltas, compatibility |
| `/admin/models` | Admin | Protected by `VITE_ADMIN_API_KEY` header in live; mock gate in fixture mode. List/clone/edit/validate/backtest/activate |

## Component tree

```
App
├── AppHeader (nav)
└── RouterView
    ├── HomePage
    │   ├── CharacterSearchForm
    │   │   ├── RegionSelect
    │   │   ├── RealmAutocomplete
    │   │   └── NameInput
    │   └── RecentSearches
    ├── CharacterPage
    │   ├── ProfileHeader (score, grade, confidence, freshness, refresh)
    │   ├── StatusBanner (queued/stale/not-found/incomplete/degraded)
    │   ├── TrustRadarChart (+ accessible table)
    │   ├── DimensionCards
    │   ├── AuthenticitySection
    │   ├── AnalyzedRunsSection
    │   ├── EquipmentTalentsSection
    │   ├── SeasonSummarySection
    │   ├── SourcesAttribution
    │   └── ModelMetaFooter
    ├── ComparePage
    │   ├── CompareCandidateForm
    │   ├── CompatibilityBanner
    │   ├── TrustRadarChart (multi-series)
    │   ├── CompareTable
    │   └── DeltaSummary
    └── AdminModelsPage
        ├── AdminGate
        ├── ModelList
        ├── ModelEditor (weights, thresholds, confidence, boost)
        ├── WeightSumValidator
        └── BacktestPanel
```

## API state model

Pinia (cross-page only):

- `useRecentSearchesStore` — localStorage recent lookups.
- `useUiMetaStore` — meta/providerMode (optional).

Page-local composables (no global score cache that invents formulas):

- `useAbortableQuery` — AbortController on route leave.
- `useCharacterProfile` — load profile + map view model.
- `useRefreshPolling` — backoff while `QUEUED`/`IN_PROGRESS`; stop on FRESH/FAILED/max attempts.
- `useCompare` — single compare request.
- `useAdminModels` — list/draft/validate/activate.

Query UX states: `idle | loading | success | stale | queued | error | not_found | incomplete`.

## Loading / stale / queued / error UX

- Skeleton blocks for header, radar, cards while first load.
- Stale snapshot stays visible; banner shows refresh progress.
- Queued: poll refresh status with exponential backoff (1s → 8s cap), stop after success, failure, or ~2 min.
- Transient errors: Retry button; keep last good data if any.
- Friendly copy for not found, logs hidden, insufficient data, provider degraded, Raider.IO disabled.
- Never present “boosted” as proven fact — only probabilistic red-flag labels from API.

## Radar chart design

- Apache ECharts radar; fixed 0–100 axes.
- Stable order: Performance → Survival → Utility → Experience → Mythic Raid.
- Tooltips: score, confidence, weight.
- Accessible HTML table (or definition list) below chart with same numbers.
- Compare: toggle series to reduce overload; color + pattern/label (not color alone).

## Comparison UX

- Add 2–10 identities; client validates before submit.
- One `POST` compare (mocked).
- Sort by overall or dimension.
- Show incompatible season/model banner when entries disagree (mock includes a bad-case fixture).
- Table: grade/score, confidence, dimensions, authenticity, red flags.
- Deltas: vs median and vs best (from response).

## Admin model editor

- List versions + status (DRAFT/ACTIVE/ARCHIVED).
- Clone active → draft.
- Edit dimension weights, nested metric weights, grade thresholds, confidence params, boost thresholds.
- Client-side validate: dimension weights sum ≈ 1 (±0.001); thresholds ordered S≥A≥B≥C; nested weights valid.
- Show sum + errors; block save/activate when invalid.
- Trigger fixture backtest (mock distribution summary).
- Activate with confirm dialog; mock marks previous ACTIVE → ARCHIVED.

## Accessibility & responsive

- Keyboard nav for forms, table sort, radar series toggles, admin controls.
- Focus styles; `aria-live` for refresh status.
- Grade shown as letter + score (not color alone); red-flag severity as text.
- Contrast-aware dark game UI (product requirement).
- Breakpoints: dense desktop → stacked mobile; radar readable ≥320px width.

## Entitlement-ready rendering

- View model includes `entitlements: { detailsUnlocked, runsUnlocked, compareExpanded }` (launch: all true).
- Locked sections render placeholder / upgrade hint without requesting hidden payloads when flags false.
- Security boundary remains server-side (documented); frontend is presentation only.

## Design direction

- Dark, dense, game-compatible (per agent brief) — not Blizzard/RIO asset copies.
- CSS variables; no copyrighted art.
- Minimal motion: subtle fade-in for status banners; no excessive animation.

## Testing plan

Unit (Vitest + Vue Test Utils, `happy-dom`/`jsdom`):

- Score header, confidence warning, red flags, radar fallback text, stale/queued banner.
- Router route registration.
- Mock API client responses.
- Compare 2–10 validation.
- Admin weight validation.

Playwright (apps/web e2e, mock mode):

- Search → profile.
- Queued refresh → completed profile.
- Comparison.
- Admin draft/validate.
- A11y smoke (landmarks, headings, no obvious missing labels).
- Assert no page errors when possible.

Acceptance scripts (web package + root):

- lint, typecheck, unit tests, Playwright smoke, build.

## Implementation sequence

1. Plan (this file) + self-review.
2. Mock fixtures + typed API client + mode switch.
3. Shared UI primitives + styles.
4. Home → Profile → Compare → Admin.
5. Radar + accessibility text.
6. Tests + Playwright.
7. Architecture docs + agent handoff.
8. Acceptance run + commit.

## Risks / blockers

| Risk | Mitigation |
|------|------------|
| Agent 5 routes missing | Default mock mode; live client ready |
| Thin profile DTO | Local view model + change requests |
| Root package.json conflict | Prefer web-local scripts; minimal root edits only if required for Playwright discovery |
| ECharts a11y | Always ship textual equivalent |

## Self-review checklist

- [x] Routes match agent brief.
- [x] No scoring formulas in browser.
- [x] No provider secrets in browser.
- [x] Fixture/mock mode independent of backend.
- [x] Contracts unchanged; CRs filed for gaps.
- [x] Docs paths match ownership.
- [x] Acceptance commands defined.

**Verdict:** Plan is sufficient to implement. Proceeding to Agent-mode implementation without waiting for further approval.
