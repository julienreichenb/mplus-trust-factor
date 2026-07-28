# Wallidrixe — Wave 4 data coverage (live audit)

Status: post `wave4.1-scoring-audit` implementation. Run `pnpm live:smoke:character` against EU/archimonde/Wallidrixe after refresh to refresh this table from persisted observations.

## Eight-run selection

| Metric | Status | Notes |
|---|---|---|
| One highest key per dungeon | AVAILABLE | `selectScoringRuns` in worker refresh |
| Never demote higher unlogged run | AVAILABLE | Selection ignores WCL presence for key rank |
| `selectedRunCount` / `detailedRunCount` | AVAILABLE | Exposed on profile + score explanation |
| `selectedRuns[]` API serialization | AVAILABLE | `SelectedRunSummaryDTO` on profile |

## Performance

| Metric | Status | Notes |
|---|---|---|
| Per-fight `reportCode` + `fightId` binding | AVAILABLE | `bindParseToSelectedRun` |
| `rankPercent` / `bracketPercent` / parse percentile | PARTIAL | From WCL Parses rows when present; aggregate fallback per dungeon |
| Character-wide parse misuse | BLOCKED | Fight-bound ranking rows only for selected runs |
| Key difficulty percentile | BLOCKED | Requires season cutoff interpolation (not tuned here) |

## Survival

| Metric | Status | Notes |
|---|---|---|
| Deaths (target attribution) | AVAILABLE | `targetId === targetSourceId` |
| Avoidable damage | BLOCKED | Mechanic catalog not seeded for live season dungeons |
| Dark Pact / Unending Resolve | AVAILABLE | Warlock catalog spell IDs |
| Healthstone / potion / Drain Life | AVAILABLE | Catalog + casts/healing |
| Missing facts as unavailable | AVAILABLE | No false zero for avoidable damage |

## Utility (Warlock Demonology)

| Metric | Status | Notes |
|---|---|---|
| Spell Lock / pet interrupts | AVAILABLE | Pet `attributedSourceIds` + unfiltered interrupt fetch |
| CC distinct targets | AVAILABLE | Casts + debuffs on hostile actors |
| Demonic Gateway | AVAILABLE | Group support catalog |
| Singe Magic dispels | AVAILABLE | Pet-attributed dispels only |
| Kick activity formula | AVAILABLE | `kickActivity` + `kickSuccess` blend |

## Provider limitations

- WCL pet ownership is heuristic (name/subType), not explicit owner graph.
- Avoidable damage requires versioned mechanic rules per season dungeon.
- Eight-run detailed analysis is rate-budget bounded (`MAX_EVENT_PAGES` per category).
- Aggregate zone rankings may lack fight-level percentiles when Parses compare is empty.
