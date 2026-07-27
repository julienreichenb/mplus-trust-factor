# Blizzard endpoints

Observation date: 2026-07-27.

All calls send `namespace` + `locale` query params and `Authorization: Bearer <token>`.

## Profile (`namespace=profile-{region}`)

| Operation | Path |
|-----------|------|
| Character summary | `/profile/wow/character/{realmSlug}/{characterName}` |
| Equipment | `.../equipment` |
| Specializations | `.../specializations` |
| Media | `.../media` |
| M+ profile index | `.../mythic-keystone-profile` |
| M+ season profile | `.../mythic-keystone-profile/season/{seasonId}` |

Path name/realm: lowercased, URL-encoded.

## Game data

| Operation | Path | Namespace |
|-----------|------|-----------|
| Realm | `/data/wow/realm/{realmSlug}` | dynamic |
| Realm index | `/data/wow/realm/index` | dynamic |
| M+ season index | `/data/wow/mythic-keystone/season/index` | dynamic |
| M+ season | `/data/wow/mythic-keystone/season/{seasonId}` | dynamic |
| M+ dungeon index | `/data/wow/mythic-keystone/dungeon/index` | dynamic |
| M+ dungeon | `/data/wow/mythic-keystone/dungeon/{dungeonId}` | dynamic |
| Item | `/data/wow/item/{itemId}` | static |
| Item media | `/data/wow/media/item/{itemId}` | static |
| Playable specialization | `/data/wow/playable-specialization/{specId}` | static |
| Connected-realm M+ leaderboard | `/data/wow/connected-realm/{id}/mythic-leaderboard/{dungeonId}/period/{periodId}` | dynamic |

Leaderboard is exposed as an **explicit** method only. Do not bulk-crawl.

## Provider methods

See `BlizzardProvider` in `@mplus/contracts` (extended via change request `01-blizzard-provider-surface.md`).
