# Raider.IO OpenAPI observations

Verified against **Raider.IO Developer API v0.62.5** (`https://raider.io/swagger.json`, 2026-07-27).

## Base URL

`https://raider.io`

## Endpoints used (MVP)

### `GET /api/v1/characters/profile`

| Param | Required | Notes |
|-------|----------|-------|
| `region` | yes | `us`, `eu`, `kr`, `tw` |
| `realm` | yes | slug or title |
| `name` | yes | case-insensitive |
| `fields` | no | comma-separated; see minimal-call-matrix |
| `access_key` | no | optional app key |

### `GET /api/v1/mythic-plus/season-cutoffs`

| Param | Required | Notes |
|-------|----------|-------|
| `region` | yes | e.g. `eu` |
| `season` | no | defaults to current |

Response: `cutoffs.p750.score` = 75th percentile (top 25% threshold).

### `GET /api/v1/mythic-plus/static-data`

| Param | Required | Notes |
|-------|----------|-------|
| `expansion_id` | yes | `10` = The War Within |

### `GET /api/v1/mythic-plus/run-details`

| Param | Required | Notes |
|-------|----------|-------|
| `season` | yes | e.g. `season-tww-2` |
| `id` | yes | `keystone_run_id` |

### `GET /api/v1/periods`

No required params. Returns season period windows.

## Field syntax notes

- `mythic_plus_scores_by_season:current:previous` returns both seasons in request order
- `raid_progression:current-expansion` limits raid data scope
- Standalone `mythic_plus_scores` appears in docs but scores are retrieved via `mythic_plus_scores_by_season`

## Live verification gaps

- `GET /api/v1/mythic-plus/season-cutoffs?region=eu` returned HTTP 500 during plan verification (2026-07-27). Fixtures used for tests.

## Version pin

Provider reports `schemaVersion: "0.62.5"` in provenance metadata.
