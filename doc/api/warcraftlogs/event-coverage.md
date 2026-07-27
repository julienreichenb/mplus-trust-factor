# Event coverage and MVP metrics

Classification for scoring (Agent 4 applies final rules):

| MVP metric | WCL observability | Classification |
|------------|-------------------|----------------|
| DPS/performance percentile | `zoneRankings.rankings[].amount/total`, report rankings | **DIRECT** |
| Deaths | `Deaths` events | **DIRECT** |
| Interrupts | `Interrupts` events + `extraAbility` | **DIRECT** |
| CC casts vs successful control | `Casts` for CC spells; success requires mechanic context | **PARTIAL** |
| Defensives | `Buffs`/`Debuffs` on player around damage windows | **PARTIAL** |
| Externals | `Healing` + support cooldown `Casts` on allies | **PARTIAL** |
| Dispels/purges | `Dispels` events | **DIRECT** |
| Healthstone/potion | Consumable `Casts` if logged | **PARTIAL** |
| Avoidable damage | `DamageTaken` events — avoidability from MechanicRule catalog | **DERIVED** |
| Raid Mythic rankings | `zoneRankings` on raid zone IDs | **DIRECT** (low weight) |

## RunCombatFacts categories

Populated per selected fight for target actor (`sourceID` filter):

- casts, interrupts, deaths, damageTaken, auras, dispels, healing (optional), combatantInfo

Coverage flags and `limitations` document missing/truncated categories.

## Explicit non-claims

- Do not mark damage as avoidable in provider output
- Do not classify CC usefulness without mechanic catalog
- Do not use English spell names as identifiers (ability game IDs only)
