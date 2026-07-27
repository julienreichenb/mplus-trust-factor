# Run discovery and matching

## Discovery paths

1. **zoneRankings** — primary for M+ runs with `report.code`, `fightID`, `bracket` (key level), timestamps.
2. **recentReports** — fallback for public report codes when rankings empty.

## Selection policy

| Kind | Rule |
|------|------|
| **LATEST** | Max completion/start time among public candidates |
| **HIGHEST** | Max key level, tie-break score then recency |
| **Dedupe** | Same `(reportCode, fightID)` analyzed once |

Implementation: `selectLatestAndHighest`, `dedupeCandidates` in `@mplus/provider-warcraftlogs`.

## Cross-provider matching

`matchRunCandidate(wclCandidate, externalRun, wclRoster)` returns:

- `confidence`: `HIGH` | `MEDIUM` | `LOW` | `NONE`
- `evidence`: dungeon/key/time/duration/roster overlap
- `autoMergeAllowed`: true only for `HIGH`

### Tolerances (defaults)

- Time: ±120 seconds
- Duration: ±15 seconds
- Roster overlap HIGH: ≥80%, MEDIUM: ≥50%

### Identifiers used

| Field | WCL source | External source |
|-------|------------|-----------------|
| Dungeon | `encounterID` → slug map | `dungeonSlug` |
| Key level | `bracket` / `keystoneLevel` | `keyLevel` |
| Time | `report.startTime + fight.startTime` | `completedAt` |
| Duration | ranking `duration` / fight span | `durationMs` |
| Roster | `friendlyPlayers` | `participants[]` |

Never auto-merge below `MEDIUM` confidence.

## Visibility states

| State | Meaning |
|-------|---------|
| `PUBLIC` | Rankings or recent public reports available |
| `HIDDEN` | `character.hidden === true` |
| `NO_PUBLIC_LOGS` | Character exists but no public data |
| `PRIVATE_SKIPPED` | Only private/unlisted reports observed (never probed) |
| `UNAVAILABLE` | Archived/gated report detail — not player fault |
| `RATE_LIMITED` | Rate budget STOP/DEFER — expensive work skipped |

## Discovery bounds

| Bound | Value |
|-------|-------|
| Rankings queries | 1 (skipped if zone expired) |
| recentReports pages | 1 (`limit=20`) |
| Candidate cap | 25 (`MAX_DISCOVERY_CANDIDATES`) |
| Analysis fights | ≤2 (latest + highest, deduped) |
| Event pages / type | ≤10 |
| Events retained / type | ≤2000 |

Private and unlisted reports are filtered out; `allowUnlisted` is never set.
