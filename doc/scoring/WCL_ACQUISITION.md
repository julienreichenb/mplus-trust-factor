# WCL acquisition

**Status:** normative. Describes how Scoring acquires and caches Warcraft Logs evidence.

## Season and dungeon pool

1. Resolve the active Mythic+ season from application season authority (not a hard-coded probe character).
2. Resolve the eight active dungeons for that season.
3. Discover the character’s relevant WCL reports/fights for those dungeons.
4. Select the two best distinct runs per dungeon (up to 16):
   - key level
   - timed status
   - run score
   - evidence completeness (when available)
   - completion date
   - deterministic tie breakers

Partial coverage is allowed: missing runs reduce confidence; they are never zero-filled.

## Cache identity

A WCL run is uniquely identified by:

- `reportCode`
- `fightId`
- `reportRevision`
- `acquisitionVersion`

A changed revision or acquisition version is an ordinary cache miss. There is **no** revision reconciliation, supersession graph, or repair workflow.

## Cold vs warm

| Path | Behavior |
|------|----------|
| Cold | Fetch only missing raw runs from WCL; persist `WclRunRaw` |
| Warm | Exact identity hit → **zero** WCL capability-event calls |

One acquisition serves all fight participants. Persisted raw payloads must support provider-free digest reconstruction.

## Fight roster

- WCL actor IDs are report-local.
- Report-wide master-data players are not necessarily the fight roster.
- Derive the fight roster from fight-local evidence (CombatantInfo and relevant events).
- Target character resolution uses region + realm + character name (and application `characterId` when available), never actor ID alone.

## Rate limits and cost

- OAuth client, GraphQL execution, pagination, request fingerprinting, and rate/cost accounting remain in the WCL provider package.
- Prefer measured points; fall back to conservative estimates when measurement is unavailable.
- Live calls require `ALLOW_LIVE_PROVIDER_CALLS` + live provider mode + WCL enabled.
