# Verified WCL ReportEvents filter contract

**Authority:** hand-written `OPERATIONS.ReportEvents` in
`packages/providers/warcraftlogs/src/operations/queries.ts` (no generated SDK).

## GraphQL variables (verified present)

| Variable | Type | Notes |
|----------|------|-------|
| `code` | String! | Report code |
| `fightIDs` | [Int!] | Fight scope |
| `dataType` | EventDataType! | Casts, Buffs, DamageTaken, … |
| `sourceID` | Int | Single actor only |
| `startTime` / `endTime` | Float | Fight window + pagination |
| `limit` | Int | Page size |
| `translate` | Boolean | |
| `useAbilityIDs` / `useActorIDs` | Boolean | |
| `includeResources` | Boolean | HP fields for DamageTaken/Healing/Deaths |
| `filterExpression` | String | WCL pin/query language |
| `hostilityType` | HostilityType | Friendlies / Enemies |

**Not in the production query:** `targetID`, `abilityID`, multi-value `sourceIDs`.

## Filter capabilities (verified)

| Need | Supported? | Mechanism |
|------|------------|-----------|
| Friendly-player filtering | Yes | `filterExpression` `source.id` / `target.id` |
| Source actor filtering | Yes | `sourceID` (single) or `filterExpression` |
| Target actor filtering | Yes | `filterExpression` only |
| Ability / spell ID filtering | Yes | `filterExpression` `ability.id` / `IN` |
| Logical AND/OR / IN | Yes | Pin language; HostileCasts already uses OR |
| Multiple actor IDs | Yes | `IN` lists; do not combine with `sourceID` |
| Multiple ability IDs | Yes | `IN` lists; batch when expression too long |

## Capability acquisition policy

1. Prefer one run-level `ability.id IN (…)` for Buffs/Casts/Debuffs.
2. Deterministic ability-ID batches when length/size limits require them.
3. Actor scoping for Buffs/Casts is applied **client-side** after fetch.
   Live verification: combining `ability.id` with `source.id`/`target.id` in one
   `filterExpression` returns an empty Buff stream.
4. DamageTaken / Deaths: deterministic GraphQL `sourceID` batches (one per
   friendly player, N≤5) inside the same shared job. Live verification:
   `filterExpression` actor IN lists return empty for DamageTaken.

Filtered vs unfiltered streams use distinct compatibility keys
(`abilityFilterHash` = content hash vs `none`).
