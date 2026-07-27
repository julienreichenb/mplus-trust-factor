# Warcraft Logs limitations

## API gaps

- **Season zone ID** — live requires `WCL_MPLUS_ZONE_ID` (or constructor `zoneId`) plus recommended `WCL_MPLUS_ZONE_EXPIRES_AT`; expired zones skip rankings.
- **Encounter → dungeon mapping** — MVP uses static `ENCOUNTER_DUNGEON_MAP`; Agent 15 should seed from season metadata.
- **Run matching** — WCL ↔ Blizzard/Raider.IO matching is best-effort; low confidence never auto-merges.
- **Private logs** — Public API excludes private reports; user OAuth not implemented in MVP.
- **Archived reports** — May block events/tables without subscription; treat as `UNAVAILABLE` evidence.

## Data quality

- Event/table data is not frozen and may change without notice (per WCL docs).
- Rankings can lag re-exported reports; use `revision` for cache invalidation.
- Hidden characters (`hidden: true`) return no rankings — distinguish from API failure.

## Scope boundaries (Agent 2)

- No HTML scraping
- No fetch of all events for all historical runs
- No final Trust Factor / boost scoring
- No private `/api/v2/user` access

## Fixture mode

All automated tests use `PROVIDER_MODE=fixture`. Live smoke requires credentials and skips otherwise.
