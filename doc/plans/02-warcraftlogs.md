# Agent 2 — Warcraft Logs Integration Plan

## Current state

Agent 0 left `@mplus/provider-warcraftlogs` as a stub implementing `WarcraftLogsProvider` with `notImplemented` throws. Shared contracts define minimal provider interface (`discoverCharacterRuns`, `getReportFightDetails`). No fixtures, docs, or live client exist.

## Live-schema spike (2026-07-27)

Sources: [Character](https://www.warcraftlogs.com/v2-api-docs/warcraft/character.doc.html), [Report](https://www.warcraftlogs.com/v2-api-docs/warcraft/report.doc.html), [CharacterData](https://www.warcraftlogs.com/v2-api-docs/warcraft/characterdata.doc.html), [RateLimitData](https://www.warcraftlogs.com/v2-api-docs/warcraft/ratelimitdata.doc.html), [FightRankingMetricType](https://www.warcraftlogs.com/v2-api-docs/warcraft/fightrankingmetrictype.doc.html).

### 1. Character resolution and canonical ID

```graphql
query ResolveCharacter($name: String!, $serverSlug: String!, $serverRegion: String!) {
  characterData {
    character(name: $name, serverSlug: $serverSlug, serverRegion: $serverRegion) {
      id
      canonicalID
      name
      level
      classID
      faction
      hidden
      server { slug region { name } }
    }
  }
}
```

- Resolve by `(name, serverSlug, serverRegion)` on public `/api/v2/client`.
- `canonicalID` is stable across renames/transfers; persist as `wcl_canonical_id`.
- Null character → `NOT_FOUND` (no logs uploaded / unknown to WCL).
- **Gap:** region must be WCL region slug (e.g. `EU`), not our internal code — map `EU→EU`, `US→US`.

### 2. M+ rankings and key-level brackets

```graphql
query CharacterZoneRankings($name: String!, $serverSlug: String!, $serverRegion: String!, $zoneID: Int!) {
  characterData {
    character(name: $name, serverSlug: $serverSlug, serverRegion: $serverRegion) {
      zoneRankings(zoneID: $zoneID, metric: playerscore, byBracket: true, compare: Parses) {
        bestPerformanceAverage
        medianPerformanceAverage
        rankPercent
        totalParses
        difficulty
        metric
        partition
        zone { id name }
        rankings {
          report { code startTime endTime }
          fightID
          encounterID
          difficulty
          kill
          duration
          bracket
          score
          total
          amount
          spec
          role
          startTime
        }
      }
    }
  }
}
```

- WoW M+ uses `metric: playerscore` (enum `CharacterRankingMetricType.playerscore`).
- Key-level brackets via `byBracket: true` — bracket field on ranking rows encodes keystone level.
- `zoneID` identifies the M+ season zone (from `worldData.zones`); **not hardcoded** — resolve current season zone from game data or config mapping.
- **Gap:** exact zone ID for current season must be seeded/configured; fallback to `recentReports` discovery only.

### 3. Discover recent public M+ reports

Two complementary paths:

**A. Character recent reports (cheap):**
```graphql
character { recentReports(limit: 20, page: 1) { data { code title startTime endTime zone { id name } visibility } total has_more_pages } }
```

**B. Ranking rows (includes fight linkage):** `zoneRankings.rankings[].report.code` + `fightID`.

Filter to `visibility: public` and M+ zone encounters. Do **not** fetch full report bodies during discovery.

### 4. Ranking records and run identifiers

Ranking rows expose:
- `report.code` (report code)
- `fightID`
- `encounterID` (dungeon boss/encounter)
- `startTime`, `duration`, `bracket` (key level when `byBracket: true`)
- `score`, `amount` (performance metric value)

These are sufficient to identify a specific logged run within a report. No separate "run UUID" exists on WCL.

### 5. Latest vs highest run selection

| Selection | Primary signal | Fallback |
|-----------|----------------|----------|
| **Latest** | Max `startTime` among public M+ ranking rows + recentReports | Most recent public M+ fight from `recentReports` metadata |
| **Highest** | Max `bracket` (key level), tie-break higher `score` then `startTime` | Max key level from ranking rows only |

Dedupe when same `(reportCode, fightID)`.

### 6. Matching WCL fights to Blizzard/Raider.IO runs

`matchRunCandidate(candidate, externalRun)` compares:
- `encounterID` → dungeon slug via season dungeon mapping
- `bracket` ↔ `keyLevel`
- `startTime` ↔ `completedAt` (±120s tolerance)
- `duration` ↔ `durationMs` (±15s tolerance)
- Roster overlap from report `fights[].friendlyPlayers` vs `participants[]`

Returns `confidence: HIGH | MEDIUM | LOW | NONE` with evidence. Never auto-merge below `MEDIUM`.

**Gap:** WCL timestamps are report-relative ms + report startTime; conversion required. Raider.IO may lack report linkage — matching is best-effort.

### 7. Event/table queries and point costs

Per-fight filtered queries (single report, `translate: false`, `useAbilityIDs: false`, `useActorIDs: false` after masterData):

| Query | dataType | Typical cost (observed/fixture) |
|-------|----------|--------------------------------|
| Report metadata + fights | — | ~1–5 |
| masterData(translate: false) | — | ~5–15 (once per revision) |
| events | Casts | ~1–3 per page |
| events | Interrupts | ~1–2 per page |
| events | Deaths | ~1–2 per page |
| events | DamageTaken | ~2–5 per page |
| events | Buffs/Debuffs | ~2–5 per page |
| events | Dispels | ~1–2 per page |
| events | Healing | ~2–4 per page |
| events | CombatantInfo | ~3–8 (once per fight) |
| rateLimitData | — | ~0–1 |

Pagination: `events` returns `nextPageTimestamp`; loop with `startTime: nextPageTimestamp` until null. Guard max pages.

**Policy:** fetch masterData once; reuse actor/ability IDs; restrict `fightIDs`, `sourceID`, `limit` 100–1000.

### 8. Pagination behavior

- `recentReports`: page-based (`page`, `limit`, `has_more_pages`, `total`).
- `events`/`table`: cursor via `nextPageTimestamp` (ms within report).
- `reports(guildID...)`: page-based collection pagination.

Loop guard: max 50 event pages per category; abort on repeated timestamp.

### 9. Hidden/private/no-log cases

| State | Signal | Provider behavior |
|-------|--------|-------------------|
| Unknown character | `character: null` | `NOT_FOUND`, distinguish from API error |
| Hidden rankings | `hidden: true` | Return summary with `visibility: HIDDEN` |
| No public logs | empty rankings + empty recentReports | `visibility: NO_PUBLIC_LOGS` |
| Private report | `visibility: private` on report | Skip; do not call user API |
| API/auth failure | GraphQL errors / 401 | `UNAUTHORIZED` / `INVALID_RESPONSE` |

### 10. Point budget estimate (one character refresh)

| Step | Est. points |
|------|-------------|
| rateLimitData | 1 |
| Resolve character | 1 |
| zoneRankings (1 zone, bracket) | 5–15 |
| recentReports page 1 | 2–5 |
| Report metadata + fights (×2 runs max, combined query) | 5–10 |
| masterData (×1–2 unique reports) | 10–20 |
| Event pages per run (~6 categories × 2 pages) | 30–60 |
| **Total** | **~55–110** |

Detailed analysis only for latest + highest (deduped). Defer when `rateLimitData` ≥ 80% soft threshold.

## Implementation plan

### Package structure

```
packages/providers/warcraftlogs/src/
  types.ts                 # WclCharacterSummary, RunCombatFacts, etc.
  client/                  # OAuth, GraphQL, fingerprint, errors
  operations/              # Query documents + Zod schemas
  discovery/               # Run discovery + matching
  analysis/                # Event fetch, combat facts, revision cache
  rate/                    # Rate budget gating
  fixture/                 # Fixture-backed provider
  live/                    # Live provider
  service.ts               # High-level orchestration API
  index.ts                 # Factory + exports
```

### Contract strategy

- **No breaking changes** to `@mplus/contracts`.
- Implement existing `WarcraftLogsProvider` methods.
- Export rich WCL DTOs from `@mplus/provider-warcraftlogs`.
- Additive change request for optional extended provider interface (Agent 5 wiring).

### Fixtures

Sanitized GraphQL payloads under `tools/fixtures/warcraftlogs/` covering all acceptance scenarios.

### Tests (fixture mode)

Token management, fingerprint, pagination, actor resolution, run matching, revision cache, rate gating, fixture extraction, dedupe fetch.

### Documentation

Seven files under `doc/api/warcraftlogs/` per agent prompt.

### Smoke script

`tools/scripts/wcl-smoke.mjs` — live only when credentials present; skips gracefully otherwise.

## Assumptions

- Current M+ season zone ID provided via fixture/config mapping until Agent 5 wires live season metadata.
- Public API only (`/api/v2/client`); no PKCE/private logs in MVP.
- English ability IDs only; no localized spell names as keys.

## Out of scope

- Final scoring (Agent 4)
- Worker orchestration (Agent 5)
- Scraping WCL HTML
- Fetching all events for all historical runs

## Self-review

Plan addresses all 10 spike questions with documented gaps/fallbacks. Implementation stays within Agent 2 ownership boundaries, uses fixture-first development, and preserves shared contracts with additive extensions only.
