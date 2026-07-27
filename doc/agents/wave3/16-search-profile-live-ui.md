# Agent 16 — Exact search and live character profile UX

## Branch

`agent/w3-search-profile-ui`

## Start condition

Start after Agent 15 contracts are merged.

## Ownership

- `apps/api/**`
- `apps/web/**`
- OpenAPI/profile E2E tests

Do not redesign scoring or provider internals.

## Tasks

1. Narrow the polished MVP to exact search and character detail.
2. Search form must require region, canonical realm selection/slug and character name.
3. Preserve human-readable realm labels while sending canonical slugs.
4. On cache miss, enqueue refresh and poll with bounded backoff; support reload/deep link.
5. Render stale data immediately when available while refresh continues.
6. Render profile:
   - identity/media/class/spec/item level,
   - Blizzard rating,
   - Raider.IO score/rank and mandatory backlink,
   - recent/best runs with source badges,
   - trust score and dimensions,
   - confidence, coverage and freshness,
   - WCL public visibility/combat summary,
   - provider status and disagreement warnings.
7. Add honest states for not found/privacy ambiguous, queued, rate limited, partial providers, stale, hidden/no logs and insufficient evidence.
8. Do not expose raw payloads, secrets, internal IDs or admin keys.
9. Configure CORS and credentials for local/staging live mode without wildcard origins.
10. Keep mock/fixture UI tests and add live-shaped fixture E2E for the narrowed flow.

## Constraints

- Do not add compare/admin/addon features.
- Hidden/no logs wording must not accuse the player.
- No automatic endless polling.
- Accessibility: keyboard search, focus management, semantic status announcements.

## Acceptance

Playwright covers:

- exact search → queued → scored profile,
- deep-link reload,
- stale snapshot during refresh,
- partial Raider.IO/WCL states,
- privacy/not-found distinction,
- required Raider.IO attribution,
- no secret in browser bundle/network payload.

Write `doc/agents/16-search-profile-ui-handoff.md`, commit and stop.
