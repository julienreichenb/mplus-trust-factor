# GraphQL operations

All operations use the public client endpoint unless noted.

## RateLimitData

```graphql
query RateLimitData {
  rateLimitData {
    limitPerHour
    pointsSpentThisHour
    pointsResetIn
  }
}
```

**Observed cost:** ~0–1 point.

Live schema uses `pointsResetIn` (seconds until reset). `pointsRemaining` is derived client-side as `limitPerHour - pointsSpentThisHour`.

## ResolveCharacter

```graphql
query ResolveCharacter($name: String!, $serverSlug: String!, $serverRegion: String!) {
  characterData {
    character(name: $name, serverSlug: $serverSlug, serverRegion: $serverRegion) {
      id
      canonicalID
      name
      hidden
      server { slug region { name } }
    }
  }
}
```

**Observed cost:** ~1 point.

## CharacterZoneRankings (M+)

```graphql
query CharacterZoneRankings($name: String!, $serverSlug: String!, $serverRegion: String!, $zoneID: Int!) {
  characterData {
    character(name: $name, serverSlug: $serverSlug, serverRegion: $serverRegion) {
      zoneRankings(zoneID: $zoneID, metric: playerscore, byBracket: true, compare: Parses) {
        rankings {
          report { code startTime }
          fightID
          encounterID
          bracket
          score
          duration
          startTime
        }
      }
    }
  }
}
```

**Observed cost:** ~5–15 points (fixture estimate).

Legacy whole-zone Parses path. Prefer `Character.encounterRankings` when active-season encounter IDs are known.

## CharacterEncounterRankings (M+ per dungeon)

JSON scalar (no GraphQL subselection). Live Wallidrixe probe (zone 47, Algethar `encounterID: 112526`):

```graphql
query CharacterEncounterRankings($name: String!, $serverSlug: String!, $serverRegion: String!, $encounterID: Int!) {
  characterData {
    character(name: $name, serverSlug: $serverSlug, serverRegion: $serverRegion) {
      encounterRankings(encounterID: $encounterID, metric: playerscore, byBracket: true, compare: Parses)
    }
  }
}
```

Payload shape (observed): `{ bestAmount, medianPerformance, averagePerformance, totalKills, fastestKill, difficulty, metric, partition, zone, ranks[] }`.

Each `ranks[]` row (log-backed) includes:

| Field | Use |
|-------|-----|
| `report.code` / `report.fightID` | Distinct run identity |
| `bracketData` | Key level |
| `medal` (`bronze`/`silver`/`gold`/`none`) | Timed tri-state |
| `duration` / `startTime` | Duration + completion clock |
| `rankPercent` / `score` / `amount` | Fight-local parse + score |
| empty `report.code` + `leaderboard: 1` | Leaderboard-only — skip (no public log) |

**Observed cost (Wallidrixe live):** ~2 points / 1 HTTP per dungeon; **aliased 8-dungeon query ~9 points / 1 HTTP**.

Aliasing all active encounters in one operation is supported and is the production discovery path when `wclActiveDungeonSlugs` map to encounter IDs.

## CharacterRecentReports (REMOVED)

`CharacterRecentReports` / `character.recentReports` is **deleted** from scoring run discovery.
Do not restore it. Git history retains the old operation if needed for archaeology.

Scoring discovery is **SeasonDungeon → encounterRankings → top 2 timed identities → evidence manifest → detailed acquisition of SELECTED fights only**. See [`run-discovery-and-matching.md`](./run-discovery-and-matching.md).

## ReportWithFightAndMasterData

Combined report metadata + fights + masterData (`translate: false`). Used for **post-selection** detailed acquisition of known `(reportCode, fightId)` identities — not for run discovery.

Fight fields required for V2 candidate identity / ownership / timer tri-state:

- `id`, `encounterID`, `name`, `kill`
- `startTime`, `endTime`, `inProgress`
- `keystoneLevel`, `keystoneBonus`, `keystoneTime`
- `friendlyPlayers`

Report fields: `code`, `startTime`, `revision`, `visibility`, `zone { id name }`, `masterData.actors`.

These fields must survive GraphQL → Zod parse → normalization. Do not assume a requested GraphQL field is present on the candidate unless a mapper assigns it.

**Observed cost:** ~5–15 points per report.

## ReportEvents (paginated)

Filtered by `fightIDs`, `sourceID`, `dataType`, `translate: false`, `useAbilityIDs: false`, `useActorIDs: false`.

Categories fetched for detailed analysis:

| dataType | Purpose |
|----------|---------|
| Casts | Rotation / utility casts |
| Interrupts | Successful interrupts + interrupted spell ID |
| Deaths | Survival |
| DamageTaken | Avoidable damage inputs (classification deferred to Agent 4) |
| Buffs / Debuffs | Defensive aura context |
| Dispels | Dispels/purges |
| Healing | External support only |
| CombatantInfo | Gear/spec snapshot |

Pagination: follow `nextPageTimestamp` until null; max **10** pages per category (`MAX_EVENT_PAGES`), max **2000** events retained per category.

**Observed cost:** ~1–5 points per page depending on category.
