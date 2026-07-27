# Raider.IO OpenAPI observations (Wave 3)

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
| `access_key` | no | optional app key (**query param only**) |

Live missing character: HTTP **400** + `Could not find requested character`.

### `GET /api/v1/mythic-plus/season-cutoffs`

Optional. Live `region=eu` returned HTTP **500** on 2026-07-27. Provider capability: `unavailable`.

### `GET /api/v1/mythic-plus/static-data`

| Param | Required | Notes |
|-------|----------|-------|
| `expansion_id` | yes | `11` = Midnight, `10` = TheWarWithin, … |

### `GET /api/v1/mythic-plus/run-details`

| Param | Required | Notes |
|-------|----------|-------|
| `season` | yes | e.g. `season-mn-1` |
| `id` | yes | `keystone_run_id` |

No region query param. Infer region from roster / caller context.

### `GET /api/v1/periods`

No required params. Live shape is per-region period windows.

## Version pin

Provider reports `schemaVersion: "0.62.5"` in provenance metadata.
Expansion catalog documented as of `2026-07-27`.
