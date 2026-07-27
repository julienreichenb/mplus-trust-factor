# Character refresh state machine

```text
                 ┌──────────────┐
                 │  NOT_FOUND   │◀── negative cache / confirmed absent
                 └──────────────┘
                        ▲
   invalid/missing ─────┘
                        │
┌─────────┐  first GET  ┌──────────┐  pipeline OK   ┌─────────┐
│ unknown │────────────▶│  QUEUED  │───────────────▶│  FRESH  │
└─────────┘             │/IN_PROG. │                └────┬────┘
                        └────┬─────┘                     │
                             │ TTL exceeded              │ TTL exceeded
                             │                           ▼
                             │                      ┌─────────┐
                             └─────────────────────▶│  STALE  │── enqueue refresh (dedupe)
                                                    └─────────┘
                             pipeline fail ────────▶ FAILED (refresh-status only)
```

## HTTP mapping (GET profile)

| Condition | Status | `refreshStatus` |
|-----------|--------|-----------------|
| Negative cache hit | 404 | — |
| Score present + within TTL | 200 | `FRESH` |
| Score present + past TTL | 200 | `STALE` (+ enqueue) |
| No score (ingestion running or just queued) | 202 | `QUEUED` |

## Manual refresh (POST)

- Deduped by character identity + `forceRefresh` flag (BullMQ `jobId` = SHA-256 dedupe key).
- Cooldown: `MANUAL_REFRESH_COOLDOWN_SECONDS` from `lastPublicRefreshAt` (admin key may bypass).
- Returns existing active/queued job when reused.
- Does not wait for detailed WCL analysis beyond what the refresh pipeline already does inline in fixture mode.

## Freshness TTL

Overall profile freshness uses `BLIZZARD_CHARACTER_TTL_SECONDS` against `Character.lastPublicRefreshAt`. Source attribution is listed separately on the profile DTO.
