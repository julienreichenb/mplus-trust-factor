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

## Performance (production refresh)

Production uses `Character.zoneRankings(metric: points_and_damage, byBracket: true)` — the WCL “Points & Damage (By Level)” page. Throughput Best%/Median%/DPS come from `throughputRankings` only (never a standalone `dps` query, never fight-bound parse fallback).

| Persisted | Contents |
|-----------|----------|
| ExternalPayload / explanation `rawZoneRankingsPointsAndDamage` | Complete raw payload |
| `explanation.performanceSummary` | Normalized global + per-dungeon summary |
| Observations | `performance.current_season_peak` / `performance.current_season_consistency` |

Peak/consistency = equal-weight means of available dungeon Best%/Median%. `ratingPoints` / `keystoneLevel` / `scoreRankPercent` stay diagnostic only. `displayedRunCount` is a confidence input; WCL does not expose `throughputSampleCount`. GraphQL failure → Performance unavailable; schema mismatch → `SCHEMA_UNSUPPORTED`. Performance is independent of Survival/Utility combat ingestion. Run discovery uses encounterRankings (preferred) / zoneRankings Parses; detailed report fetch is post-selection only.

### `fastestKill` / `bestRank.speed` encoding

On score ranking rows these fields are large signed integers, not plain durations:

- Typical relation: `speed - fastestKill === -440_000_000` (not always; Windrunner Spire had equal values).
- Heuristics such as `|fastestKill| & 0xffffff` produce plausible-looking minute values but **disagree** with `ReportFight.keystoneTime` for the same character (e.g. Algeth'ar Academy 30:13 vs heuristic 32:59; Skyreach 25:57 vs 37:14).
- Zone ranking HTML exposes duration as positive milliseconds (e.g. `1855296$30:55`); that field is absent from character `zoneRankings` JSON.

Until packing is verified, production sets `completionTimeMs: null` and preserves `fastestKillRaw` / `speedRaw` / `fightMetadataRaw` only.

## Performance probe (read-only CLI)

`pnpm wcl:probe:performance` remains available for live validation of the same `points_and_damage` payload.

## Fixture mode

All automated tests use `PROVIDER_MODE=fixture`. Live smoke requires credentials and skips otherwise.
