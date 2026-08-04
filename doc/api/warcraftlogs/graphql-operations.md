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

**Observed cost:** ~2–5 points per page.

**Scoring V2 pagination:** page size 20, up to 5 pages, stopping early when `has_more_pages` is false or unique-report discovery bounds are satisfied. Report codes are deduplicated across pages. This replaces the obsolete V1 single-page discovery bound.

## ReportWithFightAndMasterData

Combined report metadata + fights + masterData (`translate: false`).

Fight fields required for V2 candidate identity / ownership / timer tri-state:

- `id`, `encounterID`, `name`, `kill`
- `startTime`, `endTime`, `inProgress`
- `keystoneLevel`, `keystoneBonus`, `keystoneTime`
- `friendlyPlayers`

Report fields: `code`, `startTime`, `revision`, `visibility`, `zone { id name }`, `masterData.actors`.

These fields must survive GraphQL → Zod parse → hydration/normalization. Do not assume a requested GraphQL field is present on the candidate unless a mapper assigns it.

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
