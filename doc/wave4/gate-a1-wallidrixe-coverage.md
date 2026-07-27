# Gate A.1 — Eight-dungeon coverage matrix (Wallidrixe)

Character: `EU/archimonde/Wallidrixe`  
Live smoke: **SKIP** — `WCL_CLIENT_ID` / `WCL_CLIENT_SECRET` not configured in this worktree (`.env` absent). Re-run:

```bash
pnpm wcl:smoke -- --region EU --realm archimonde --name Wallidrixe --deep
```

## Pipeline status (Gate A.1)

| Control | Status |
|---|---|
| Analyze all `ScoringRunSelection` entries | AVAILABLE (`analyzeScoringRuns` in refresh pipeline) |
| Configurable bound `WCL_MAX_ANALYSIS_FIGHTS` | AVAILABLE (default 8, hard cap 16) |
| Selection: key → score → timed → latest | AVAILABLE |
| Never demote unlogged highest | AVAILABLE |
| Report/fight dedupe + session cache | AVAILABLE |
| Per-run Survival/Utility raw facts | AVAILABLE (`*.v3.*` observations) |
| Score weights / `default@3` | Unchanged |

## Expected eight-dungeon matrix (schema)

Smoke `scoringV3Foundation` emits one row per dungeon with:

| Field | Meaning |
|---|---|
| `dungeonSlug` | Canonical Midnight S1 dungeon |
| `keyLevel` / `timed` / `selectionReason` | Selected canonical run |
| `detailAvailable` | WCL combat facts present for that highest key |
| `rejectionReasons` / `missingDataReasons` | Explicit gaps |
| Survival + Utility raw fields | Per-run facts or BLOCKED |
| `selectedRunCount` / `analyzedFightCount` / `missingCombatFactCount` / `wclApiCallCount` | Aggregate diagnostics |

### Dungeon checklist

| # | Dungeon | Selection | Combat facts | Notes |
|---:|---|---|---|---|
| 1 | magisters-terrace | highest key | live-dependent | |
| 2 | maisara-caverns | highest key | live-dependent | |
| 3 | nexus-point-xenas | highest key | live-dependent | |
| 4 | windrunner-spire | highest key | live-dependent | |
| 5 | algethar-academy | highest key | live-dependent | |
| 6 | seat-of-the-triumvirate | highest key | live-dependent | |
| 7 | skyreach | highest key | live-dependent | |
| 8 | pit-of-saron | highest key | live-dependent | |

Regression coverage (no live credentials required):

- eight selected → eight analysis attempts
- six logs → six facts + two unavailable
- duplicate report/fight fetched once
- unlogged highest not replaced
- partial provider failure isolates to one dungeon
- out-of-season runs excluded

See `doc/wave4/data-coverage-wallidrixe.md` for metric-level AVAILABLE / PARTIAL / BLOCKED.
