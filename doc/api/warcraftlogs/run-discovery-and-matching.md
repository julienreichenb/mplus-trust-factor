# Run discovery and matching

## Report → Fight → DungeonPull model (verified)

Warcraft Logs scopes that matter for Mythic+ ownership:

| Scope | Meaning |
|-------|---------|
| **Report** | Uploaded container. May contain multiple Mythic+ dungeons, raid pulls, trash, and multiple player groups. `masterData.actors` is **report-wide**. |
| **ReportFight** | For Mythic+, one fight is one entire keystone dungeon. `fight.friendlyPlayers` is **fight-specific**. |
| **DungeonPull** | Individual dungeon pulls are **not** separate fights. |

Canonical run identity after hydration:

```text
reportCode + fightId + reportRevision
```

Never use `reportCode` alone. Never confuse WCL character profile IDs with report-local actor IDs.

## Ownership invariant

A fight belongs to a target character only when **all** of the following hold:

1. the report is public;
2. the fight is Mythic+ (`keystoneLevel > 0`);
3. the character is resolved in `masterData` by normalized name + realm;
4. the resolved report-local actor ID is present in `fight.friendlyPlayers`.

Structured rejection reasons (do not collapse into `FALLBACK_EXHAUSTED`):

| Reason | Meaning |
|--------|---------|
| `TARGET_NOT_IN_REPORT` | No matching Player actor in masterData |
| `TARGET_NOT_IN_FIGHT` | Actor found in masterData but absent from `friendlyPlayers` |
| `TARGET_AMBIGUOUS` | Multiple distinct masterData actor IDs match name+realm |
| `FIGHT_NOT_MYTHIC_PLUS` | No positive `keystoneLevel` |
| `FIGHT_INCOMPLETE` / `INCOMPLETE_FIGHT` | Fight still `inProgress` or start/end incoherent |

Confirmed regression: report `8WawmdrjbYtRFPqy` fight `1` — Wallidrixe is report-local actor `317` in masterData but `friendlyPlayers` is `[3,7,4,1,5]` (Coomerhabile=`1`). Wallidrixe must be rejected as `TARGET_NOT_IN_FIGHT` with **zero** `ReportEvents` calls.

## Discovery paths

1. **encounterRankings** (preferred) — one aliased GraphQL call per active-season dungeon encounter ID. Each `ranks[]` row can supply `report.code` + `report.fightID`, `bracketData` (key), `medal` → timed, `duration`/`startTime`, and fight-local `rankPercent`. When every active dungeon has ≥2 timed log-backed identities, **skip** `recentReports` pagination and mass report hydration.
2. **zoneRankings** (`compare: Parses`) — legacy whole-zone fallback when active encounter IDs are unavailable.
3. **recentReports** — fallback stubs only when encounter/zone rankings cannot fill timed coverage; hydration then opens only remaining fightUnknown stubs.

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

Scoring V2 evidence selection (see `doc/scoring/v2/03_WCL_EVIDENCE_SELECTION_CONTRACT.md`):

| Bound | Value |
|-------|-------|
| Rankings queries | 1 (skipped if zone expired) |
| recentReports page size | 20 (`MAX_RECENT_REPORTS_LIMIT`) |
| recentReports max pages | 5 (`MAX_RECENT_REPORT_PAGES`) — stops earlier on `has_more_pages=false` or when unique-report bounds are satisfied |
| Candidate retention | up to 10 per active dungeon, 80 total |
| Selected slots | `activeDungeonCount × 2` distinct `(reportCode, fightId)` identities |
| Event pages / type | ≤10 |
| Events retained / type | ≤2000 |

Pagination must never blindly hydrate every report. Discovery stays metadata-first; fight/masterData hydration is lazy for selected/fallback candidates only.

Discovery retains timer tri-state (`timed: true | false | null`) on candidate metadata. Hydration coverage early-stop and scoring plan eligibility both require `timed === true` (2 distinct timed identities per active dungeon). Untimed and timer-unknown runs remain discoverable but do not fill coverage targets and are rejected at plan construction (`UNTIMED_RUN` / `TIMED_STATE_UNKNOWN`); they are never detailed-fetched for scoring.

Ownership is proven **before** any `ReportEvents` call. Candidate-level rejection reasons are preserved through acquisition fallback and must not collapse solely into `FALLBACK_EXHAUSTED`.

Private and unlisted reports are filtered out; `allowUnlisted` is never set.

### Legacy V1 analysis bounds (refresh path)

| Bound | Value |
|-------|-------|
| Analysis fights | ≤2 (latest + highest, deduped) |
