# Agent 14 — Warcraft Logs public live provider

## Branch

`agent/w3-warcraftlogs-live`

## Ownership

- `packages/providers/warcraftlogs/**`
- WCL fixtures/tests
- `doc/research/providers/warcraftlogs-live-api.md`

Do not edit worker orchestration, scoring, API or Vue application.

## Tasks

1. Keep OAuth client credentials and `/api/v2/client` public data only.
2. Resolve the exact target character from `ProviderFetchContext.targetCharacter`; remove normal-refresh dependence on defaults.
3. Replace the static Mythic+ zone default with validated current-zone configuration/discovery and an expiry warning.
4. Bound character discovery: one rankings query when valid, one limited recent-report page, and a documented candidate cap.
5. Never probe private/unlisted reports; do not use generic `allowUnlisted: true`.
6. Model `PUBLIC`, `HIDDEN`, `NO_PUBLIC_LOGS`, `PRIVATE_SKIPPED`, `UNAVAILABLE`, and `RATE_LIMITED` consistently.
7. Correct optimistic run placeholders:
   - do not default `timed=true`,
   - do not claim an unknown season/dungeon,
   - expose incomplete roster/match facts,
   - return a candidate-match confidence.
8. Bound detailed event ingestion by reports, fights, event types, pages/events and rate budget.
9. Harden actor resolution and fail safely on ambiguity.
10. Move the stable normalized `RunCombatFacts` contract to `@mplus/contracts` through a documented CR, or provide a migration-ready contract proposal without editing shared files.
11. Add tests for hidden/no logs, archived/unavailable details, GraphQL errors, rate budget, pagination and actor ambiguity.

## Constraints

- Absence of public logs must never directly lower performance score.
- No user OAuth or private reports.
- No CI live calls.
- Persist normalized facts; bound raw event retention.

## Acceptance

- A manual public-character smoke resolves visibility and at most the configured bounded evidence.
- Hidden/no-log fixtures return a successful provider state with zero combat coverage, not a player error.
- Rate budget prevents expensive work before hard failure.

## Handoff

Write `doc/agents/14-warcraftlogs-live-handoff.md`, commit and stop.
