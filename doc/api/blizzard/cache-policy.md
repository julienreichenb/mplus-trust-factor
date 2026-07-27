# Blizzard cache policy

| Endpoint key | TTL | Notes |
|--------------|-----|-------|
| OAuth token | `expires_in - 60s` | Memory; refresh deduped |
| `character.profile` | 24h (`BLIZZARD_CHARACTER_TTL_SECONDS`) | |
| `character.equipment` / specializations | 6h | |
| `character.media` | 24h | |
| `character.mplus.index` / current season | 6h | |
| Historical M+ season profile | 30d | Near-immutable |
| Realm | 7d | |
| Season index | 24h | |
| Season detail (historical) | 30d | |
| Dungeon index/detail | 7d | |
| Item / item media | 7d | Only requested IDs |
| Leaderboard | 1h | Explicit calls only |
| Negative cache (404) | 30m | Fixture/live policy |

Also:

- Request fingerprint cache (`provider|region|endpoint|params|authScope`).
- In-flight dedupe per fingerprint.
- Conditional GET via `ETag` / `Last-Modified` when present.
- Concurrency default 4 (`BLIZZARD_REQUEST_CONCURRENCY`).
- Retry idempotent GET only; honor `Retry-After` on 429.
