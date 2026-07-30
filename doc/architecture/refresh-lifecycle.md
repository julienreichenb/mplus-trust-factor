# Refresh lifecycle

## Programme policy (target)

Programme target (embedded in [`.cursor-orchestration/`](../../.cursor-orchestration/2026-07-stabilization/) prompts; also summarized here):

- A published Trust Score is fresh for **7 days**.
- Fresh profile reads are strictly read-only (no refresh job).
- Stale profile returns the **last published** score immediately and may enqueue **exactly one** background refresh.
- Repeated reads while a job exists reuse that job.
- A completed refresh must not be re-armed by another page view.
- Provider freshness and score freshness are **distinct**.
- Failed refresh keeps the last published snapshot and applies retry/backoff.
- Manual force refresh is **admin-only**.

## Current runtime (verify in code)

Authority: `apps/api/src/lib/freshness.ts`, `apps/api/src/services/character-service.ts`, `packages/config`.

| Concept | Current behaviour |
|---------|-------------------|
| Score / profile freshness gate | `isFresh(lastPublicRefreshAt, ttl)` |
| Default TTL | Driven by `BLIZZARD_CHARACTER_TTL_SECONDS` (default **86400 = 1 day**), not yet a dedicated 7-day score-freshness env |
| Provider TTLs | Separate config in `packages/config` (Blizzard / WCL / Raider.IO differ) |
| Score vs newer providers | `isScoreStaleVersusProviders` can mark STALE even if TTL-fresh |
| Stale read | Returns last published snapshot; may enqueue refresh |
| Search path | `searchCharacter()` can also enqueue when stale |

**Doc rule:** state the **7-day programme target** and the **current TTL wiring** side by side until Agent 03 / config work aligns them. Do not claim the default is already 7 days.

## Last-known-good

- Public pointer: `CharacterPublishedScore` → immutable `ScoreSnapshot`.
- Soft provider failures merge prior observations (`mergeObservationsWithLastKnownGood`) rather than wiping published skill dims.
- Rejected incomplete candidates stay non-public; published pointer unchanged.

## Known gap

Multiple enqueue side effects on one page read — see Agent 01 findings / Agent 03 prompt. Docs describe desired single decision result; implementation may still diverge.
