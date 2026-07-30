# CR — Agent 03 refresh lifecycle / force-refresh contract

## Summary

Centralize Trust Score refresh decisions behind a 7-day published-score TTL and
document the admin force-refresh API contract for Agent 04 IAM wiring.

## Motivation

Profile/search/account reads previously used provider-oriented TTL
(`BLIZZARD_CHARACTER_TTL_SECONDS`, default 1 day) and multiple independent
enqueue side effects per page view, causing refresh storms.

## Contract changes

### Config

| Env | Default | Meaning |
|-----|---------|---------|
| `SCORE_TTL_SECONDS` | `604800` (7d) | Published snapshot freshness (`calculatedAt`) |
| `REFRESH_FAILURE_BACKOFF_SECONDS` | `3600` | Ordinary reads must not re-enqueue after FAILED |

`calculated.score_snapshot` in `buildFreshnessConfig` now uses `SCORE_TTL_SECONDS`
(not Blizzard character TTL).

### Decision function

`decideScoreRefresh()` in `@mplus/config` returns a single reasoned decision.
Profile and search execute at most one side effect from that decision.

### Public score lifecycle (provider states remain separate)

| State | Meaning |
|-------|---------|
| `NO_SCORE_QUEUED` | No published score; refresh queued |
| `CALCULATING` | No published score; job ACTIVE |
| `FRESH` | Within score TTL |
| `STALE_USABLE` | TTL/contract stale; last score shown |
| `REFRESHING` | Usable score + active job |
| `FAILED_FALLBACK` | Recent failure; last score shown; backoff |
| `UNAVAILABLE` | No score + failed (terminal until backoff ends) |
| `GRADE_U` | Published grade U (eligibility); still TTL-fresh |

Coarse wire enum for profile/search is `FRESH | QUEUED | STALE | REFRESHING`.
`REFRESHING` is used when a usable published score exists with an in-flight job.
`STALE` means the published score is usable but requires updating.
`FAILED_FALLBACK` still maps to coarse `STALE`.

### Account list

`AccountTrustScoreStatus` gains `REFRESHING`: score stays visible while a
background job runs. Account navigation never enqueues.

### Force refresh (Agent 04)

`POST /api/v1/characters/:region/:realm/:name/refresh`

| Privilege | Permission | Effect |
|-----------|------------|--------|
| Request refresh | `profile.refresh.request` (existing public POST) | Enqueue subject to cooldown |
| Bypass cooldown | `profile.refresh.cooldown_bypass` | Skip manual cooldown; does **not** set `forceRefresh` |
| Force provider refresh | `profile.refresh.force` | Sets job `forceRefresh: true` (bypass provider caches) |

`CharacterService.requestRefresh` now takes:
```ts
{ bypassCooldown: boolean; forceRefresh: boolean; correlationId?: string | null }
```

Emergency admin API key still grants both bypass + force when
`ADMIN_API_KEY_EMERGENCY_FALLBACK` is enabled.

Agent 04 owns IAM enforcement / UI placement; Agent 03 owns the API shape above.

## Compatibility

- No Prisma migration.
- Existing clients ignoring unknown account status values remain safe if they
  treat unknown as non-AVAILABLE; web Account page updated for `REFRESHING`.
- Provider-newer-than-score is warning-only (no enqueue).

## Validation

Unit tests: `packages/config/src/score-refresh-decision.test.ts`,
`apps/api/src/services/character-service.refresh-policy.test.ts`.
