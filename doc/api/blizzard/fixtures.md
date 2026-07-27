# Blizzard fixtures

Root: `tools/fixtures/blizzard/`

| File | Purpose |
|------|---------|
| `manifest.json` | Identity → fixture file map |
| `character-profile-normal.json` | Max-level EU character |
| `character-profile-accented.json` | Accented display name |
| `equipment-key-items.json` | Trinkets / rings as key items |
| `specializations-multi.json` | Multiple specs + loadout code |
| `media-avatar.json` | Avatar/inset/main assets |
| `mythic-keystone-profile-index.json` | Current rating + seasons |
| `mythic-keystone-season-current.json` | Best runs |
| `partial-fields.json` | Missing optional equipment fields |
| `realm-tarren-mill.json` | Realm metadata |
| `season-index.json` / `season-current.json` | Season static |
| `dungeon-index.json` / `dungeon-sample.json` | Dungeons |
| `item-sample.json` / `item-media-sample.json` | Item + icon |
| `errors/404.json`, `429.json`, `500.json` | Error bodies |

Manifest character keys: `REGION:realm-slug:normalized-name` (e.g. `EU:tarren-mill:examplecharacter`).

All payloads are sanitized fiction; no real player PII beyond public-shaped structures.
