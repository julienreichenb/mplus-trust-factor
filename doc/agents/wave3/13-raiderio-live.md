# Agent 13 — Raider.IO live character profile

## Branch

`agent/w3-raiderio-live`

## Ownership

- `packages/providers/raiderio/**`
- Raider.IO fixtures/tests
- `doc/research/providers/raiderio-live-api.md`

Do not edit the worker pipeline, scoring, API or Vue application.

## Tasks

1. Use the documented `/api/v1/characters/profile` endpoint with the minimum explicit fields:
   - gear,
   - talents,
   - current-season scores,
   - ranks,
   - recent runs,
   - best runs.
2. Normalize score, ranks, profile URL, `last_crawled_at`, gear and run facts into stable DTOs.
3. Preserve attribution data required to render a visible Raider.IO backlink.
4. Fix `fetchRunDetails()` returning hardcoded `EU`.
5. Remove the unversioned hardcoded expansion assumption; dynamically resolve or explicitly version/validate it.
6. Make `season-cutoffs` optional and non-blocking. Add a capability state when the endpoint is unavailable.
7. Replace in-memory-only cache behavior with the shared persistent external request cache, or expose cache metadata so Agent 15 can do so without duplicating requests.
8. Handle 429/`Retry-After`, timeout, transient failure and malformed JSON.
9. Do not guess how `RAIDERIO_APP_KEY` is transmitted; implement it only from approved documentation/configuration.
10. Update fixtures and research documentation.

## Constraints

- No page scraping.
- Raider.IO score remains a source fact, not the product score.
- Do not add alternate-character inference to the MVP.
- Keep the legal/commercial launch gate documented.

## Acceptance

- Tests cover current profile, stale `last_crawled_at`, missing optional fields, 404, 429, 5xx and malformed response.
- Output includes source profile URL and attribution marker.
- Manual smoke works without an application key within documented public limits.

## Handoff

Write `doc/agents/13-raiderio-live-handoff.md`, commit and stop.
