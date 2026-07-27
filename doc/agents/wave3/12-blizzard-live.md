# Agent 12 — Blizzard live provider hardening

## Branch

`agent/w3-blizzard-live`

## Ownership

- `packages/providers/blizzard/**`
- Blizzard fixtures/tests
- `doc/research/providers/blizzard-live-api.md`

Do not edit the worker pipeline, scoring, API or Vue application.

## Tasks

1. Revalidate every used endpoint, namespace, locale and region against current official Blizzard documentation.
2. Implement/verify:
   - canonical character profile,
   - equipment,
   - specializations,
   - character media,
   - Mythic+ profile index,
   - dynamic current season/period,
   - current-season best runs.
3. Reconcile the media endpoint path (`character-media` versus the current `/media` implementation) with a contract test.
4. Normalize exact identity and distinguish:
   - confirmed invalid request,
   - not found,
   - profile unavailable/privacy sharing disabled,
   - rate limited,
   - transient upstream failure.
5. Add token single-flight caching, timeout, capped retries with jitter and `Retry-After` support.
6. Emit normalized observations and provenance without secrets or raw authorization data.
7. Add live smoke tooling hooks but keep tests fixture/recording based.
8. Add response-shape contract fixtures for all MVP endpoints.
9. Update the provider research doc with verified paths and unresolved API discrepancies.

## Constraints

- Support `EU`, `US`, `KR`, `TW`; do not claim China support.
- Do not implement fuzzy character search.
- Do not treat season profile results as full history.
- No fixed current season ID.

## Acceptance

- Fixture and recorded-response tests cover success, privacy/404, 429, malformed response and token refresh.
- A manual allowlisted smoke retrieves one real character’s identity, equipment, media and current M+ data.
- No live external request runs in CI.

## Handoff

Write `doc/agents/12-blizzard-live-handoff.md`, commit and stop.
