> **Superseded:** `WCL_MPLUS_ZONE_MODE` / `WCL_MPLUS_ZONE_ID` env authority was removed. Scoring season is AUTO | PINNED via DB `RuntimeSetting` (`scoring_season_selection`). See `doc/scoring/v2/` and `effective-scoring-season.ts`.

# Active Mythic+ Season Authority

Versioned contract: `ActiveMythicPlusSeasonAuthority` (`active-mplus-season-authority-v1`).

## Modes

| Mode | Env | Behavior |
|------|-----|----------|
| **AUTO** (default) | `WCL_MPLUS_ZONE_MODE=auto` | Resolve the validated `isCurrent` season with persisted `SeasonDungeon` bindings + `metadata.activeMplusCatalog`. `WCL_MPLUS_ZONE_ID` is **diagnostic only** (mismatch warned, never forces selection). |
| **PINNED** | `WCL_MPLUS_ZONE_MODE=pinned` + required `WCL_MPLUS_ZONE_ID` | Resolve exactly that WCL zone’s validated catalog. No silent fallback to AUTO. |

There is **no** silent AUTO→PINNED fallback.

## What production must not do

- Prefer `blizzard-season-17` (or any hard-coded slug)
- Fall back from empty `SeasonDungeon` to `CURRENT_MPLUS_ZONE_DUNGEON_SLUGS`
- Treat `isCurrent` alone as sufficient without validated catalog metadata
- Let `placeholder-current` / `auto-current` outrank a validated provider-backed season

Empty bindings → `SEASON_DUNGEON_BINDINGS_MISSING` (fail closed).

## Synchronization

`synchronizeActiveMplusSeasonCatalog`:

1. Takes Blizzard `blizzardSeasonId` from season-index authority (not max zone id / insert order)
2. Resolves WCL zone catalog from the versioned registry (or explicit `wclZoneId`)
3. Upserts `Dungeon` + `SeasonDungeon` bindings
4. Writes `metadata.activeMplusCatalog` (pool hash, zone, lastKnownGood)
5. Atomically activates one season and clears other `isCurrent` flags
6. Preserves historical seasons / manifests / packages / digests / scores

Ambiguous registry mapping → `ACTIVE_MPLUS_SEASON_AMBIGUOUS`  
Incomplete mapping → `ACTIVE_MPLUS_SEASON_CATALOG_INCOMPLETE`  
Do not continue scoring on the previous season once a new active season is known but unresolved — sync must complete before activation; unresolved candidates leave the prior validated season current until activation succeeds.

## Manifest shape

```
runsPerDungeon = 2
expectedSlotCount = activeDungeons.length * 2
```

Midnight S1 (8 dungeons) → 16 slots. A 9-dungeon season → 18 slots.  
If the score model max evidence slots (v6: 16) is exceeded → `SCORE_MODEL_SEASON_SHAPE_INCOMPATIBLE` (blocks publication, does not corrupt sync/discovery diagnostics).

## Local repair (do not run against staging/production)

Season catalog sync/validation is part of the consolidated pipeline
(`pnpm scoring-v2:canary` when execute-armed). Provider-free inspection:

```powershell
pnpm scoring-v2:doctor -- --region EU --realm <realm> --character <name>
```

Repair synchronizes bindings for the Blizzard-backed season and deactivates competing placeholder currents after validation. Historical rows are never deleted. See [`25_OPERATOR_SURFACE_AND_PIPELINE.md`](./25_OPERATOR_SURFACE_AND_PIPELINE.md).

## Lifecycle states

`ACTIVE_SEASON_CURRENT` · `ACTIVE_SEASON_METADATA_STALE` · `NEW_SEASON_DETECTED` · `NEW_SEASON_VALIDATING` · `NEW_SEASON_CATALOG_INCOMPLETE` · `NEW_SEASON_MODEL_INCOMPATIBLE` · `NEW_SEASON_ACTIVATED`

## Callers

Refresh, Scoring V2 shadow/canary, discovery inputs, manifest lookup, and publication eligibility must share the same lineage:

`applicationSeasonId` + `wclZoneId` + `dungeonPoolHash` + `catalogVersion`
