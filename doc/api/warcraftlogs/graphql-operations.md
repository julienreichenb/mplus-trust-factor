# GraphQL operations

All operations use the public client endpoint unless noted.

## RateLimitData

```graphql
query RateLimitData {
  rateLimitData {
    limitPerHour
    pointsSpentThisHour
    pointsRemaining
    resetInSeconds
  }
}
```

**Observed cost:** ~0–1 point.

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

## CharacterRecentReports

```graphql
query CharacterRecentReports($name: String!, $serverSlug: String!, $serverRegion: String!, $limit: Int!, $page: Int!) {
  characterData {
    character(name: $name, serverSlug: $serverSlug, serverRegion: $serverRegion) {
      recentReports(limit: $limit, page: $page) {
        data { code startTime visibility zone { id name } }
        has_more_pages
      }
    }
  }
}
```

**Observed cost:** ~2–5 points.

## ReportWithFightAndMasterData

Combined report metadata + fights + masterData (`translate: false`).

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

Pagination: follow `nextPageTimestamp` until null; max 50 pages per category.

**Observed cost:** ~1–5 points per page depending on category.
