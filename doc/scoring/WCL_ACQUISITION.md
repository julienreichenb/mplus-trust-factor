# WCL acquisition

**Status:** normative. Describes how Scoring acquires and caches Warcraft Logs evidence.

Common run-selection and dimension-phase product policy:
[`DIMENSION_PHASES.md`](DIMENSION_PHASES.md) (eight dungeons, two runs each, profile
summary). Functional phases are not redefined here.

## Season and dungeon pool

1. Resolve the active Mythic+ season from application season authority (not a hard-coded probe character).
2. Resolve the eight active dungeons for that season.
3. Discover the character’s relevant WCL reports/fights for those dungeons.
4. Select the two best distinct **timed** runs per dungeon (up to 16).

   Scoring run evidence eligibility:

   ```text
   public + active-season + valid key + TIMED === true.
   Untimed and timer-unknown runs are never detailed-fetched for scoring.
   ```

   Among eligible (`timed === true`) candidates, order by:
   - key level (DESC)
   - immutable `reportCode` / `fightId` tie-break
   - residual completeness / completion fields only for pathological duplicates

   Discovery may still inspect untimed or timer-unknown fights for coverage metadata;
   those fights must not enter the scoring acquisition plan.

Partial coverage is allowed: missing runs reduce confidence; they are never zero-filled.
Fewer-than-sixteen confidence/publication policy is a separate chantier.

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

## Character Performance aggregate (`points_and_damage`)

This payload is **character/season** evidence (zone rankings metric `points_and_damage`),
not fight-local evidence.

| Mode | Provider calls |
|------|----------------|
| Cold (no fresh `CharacterPerformanceAggregate`) | Exactly one `CharacterZoneRankingsPointsAndDamage` |
| Warm (fresh compatible row) | Zero |
| Provider-free replay (compatible row, expired OK) | Zero |

Production uses `fetchCharacterPerformanceAggregate` / `ensureCharacterPerformanceAggregate`.
Raw WCL JSON and normalized dungeon aggregates (best/median percentiles, run counts, bracket/spec
metadata, global summary) are persisted together with a canonical content hash.
Missing aggregate evidence affects Performance availability only; it must not zero Utility or Survival.

## Fight roster

- WCL actor IDs are report-local.
- Report-wide master-data players are not necessarily the fight roster.
- Derive the fight roster from the capability package’s `friendlyPlayerActorIds` intersected with persisted report `masterData` (and CombatantInfo enrichment when present).
- Persist `masterData` inside `WclRunRaw.payload` (`wcl-run-raw-payload-v1`) at cold acquisition so warm cache and provider-free replay resolve the same roster without another WCL call.
- Target character resolution uses region + realm + character name (and application `characterId` when available), never actor ID alone across reports.
- Non-target participants may have `characterId: null`. Characters are never auto-created during roster resolution.
- Missing raw roster/`masterData` cannot trigger a provider call during replay — return a structured unavailable/incompatible outcome instead.
- Placeholder identities such as `Actor123` are not valid production roster outputs when masterData is present.

## Rate limits and cost

- OAuth client, GraphQL execution, pagination, request fingerprinting, and rate/cost accounting remain in the WCL provider package.
- Prefer measured points; fall back to conservative estimates when measurement is unavailable.
- Live calls require `ALLOW_LIVE_PROVIDER_CALLS` + live provider mode + WCL enabled.
