# Refresh lifecycle

## Programme policy (canonical)

- A published Trust Score is fresh for **7 days** (`SCORE_TTL_SECONDS`, default `604800`).
- Freshness is based on the published snapshot **calculation/publication time** (`ScoreSnapshot.calculatedAt`), not provider TTL.
- Fresh profile/search/account reads are strictly read-only (no refresh job).
- A stale profile returns the **last published** score immediately and may enqueue **exactly one** background refresh.
- Repeated reads while a job exists reuse that job (`REUSE_ACTIVE_JOB`).
- A completed refresh must not be re-armed by another page view while still within the score TTL.
- Provider freshness and score freshness are **distinct**.
- Provider-newer-than-score is a **diagnostic warning only** (does not enqueue).
- Failed refresh keeps the last published snapshot and applies `REFRESH_FAILURE_BACKOFF_SECONDS` (default 1h).
- Manual force refresh (`forceRefresh: true`) requires `profile.refresh.force`; cooldown bypass is separate (`profile.refresh.cooldown_bypass`).

Authority: `packages/config/src/score-refresh-decision.ts`, `apps/api/src/services/character-service.ts`, `packages/config`.

## Decision model

`decideScoreRefresh()` returns one reasoned decision. Callers execute at most one side effect.

| Action | When |
|--------|------|
| `NONE` | Within score TTL (optionally with provider-newer diagnostic) |
| `ENQUEUE` | No score, TTL expired, or provider-evidence-incompatible contract |
| `RECALCULATE` | Scoring model changed only (persisted evidence still compatible) |
| `REUSE_ACTIVE_JOB` | QUEUED/ACTIVE job already exists |
| `BACKOFF` | Recent FAILED job within failure backoff |

## Public score lifecycle

Provider states remain separate (`CharacterProviderState`).

| State | Coarse profile `refreshStatus` | Notes |
|-------|--------------------------------|-------|
| `NO_SCORE_QUEUED` | `QUEUED` | HTTP 202 when no snapshot |
| `CALCULATING` | `QUEUED` | Job ACTIVE, no score yet |
| `FRESH` | `FRESH` | Within TTL |
| `GRADE_U` | `FRESH` | Published grade U; eligibility, not missing score |
| `STALE_USABLE` | `STALE` | Last score shown; refresh may be enqueued |
| `REFRESHING` | `STALE` | Last score shown + in-flight job |
| `FAILED_FALLBACK` | `STALE` | Last score shown; backoff |
| `UNAVAILABLE` | `QUEUED` | No score after failed refresh |

Account list uses `AccountTrustScoreStatus`, including `REFRESHING` so polling does not hide a completed score behind a loading-only state.

## Config

| Concept | Behaviour |
|---------|-----------|
| Score TTL | `SCORE_TTL_SECONDS` (default 7 days) |
| Provider TTLs | Separate in `packages/config` (Blizzard / WCL / Raider.IO) |
| Dataset `calculated.score_snapshot` | Uses `SCORE_TTL_SECONDS` |
| Failure backoff | `REFRESH_FAILURE_BACKOFF_SECONDS` (default 3600) |
| Manual cooldown | `MANUAL_REFRESH_COOLDOWN_SECONDS` (POST refresh only) |

## Last-known-good

- Public pointer: `CharacterPublishedScore` → immutable `ScoreSnapshot`.
- Soft provider failures merge prior observations (`mergeObservationsWithLastKnownGood`) rather than wiping published skill dims.
- Rejected incomplete candidates stay non-public; published pointer unchanged.

## Force refresh contract (Agent 04)

See [`../contracts/change-requests/03-refresh-lifecycle.md`](../contracts/change-requests/03-refresh-lifecycle.md).
