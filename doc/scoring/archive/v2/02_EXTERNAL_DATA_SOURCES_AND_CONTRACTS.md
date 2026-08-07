---
status: proposed
normative: true
last_reviewed: 2026-08-01
repository: julienreichenb/mplus-trust-factor
baseline_main: 0b0d911f9c4f3ec771bd8f2390e972da01595f99
calibration_draft_branch: agent/11-scoring-calibration-study
calibration_draft_head_observed: 5603d4b8f01375599fa0bb71255b98d775cd8e4d
---


# External data sources and contracts

## 1. Source priority

| Domain | Primary source | Secondary source | Restricted fallback |
|---|---|---|---|
| Identity, class, spec, role | Blizzard | WCL actor metadata | none |
| Current season authority and dungeon pool | Blizzard | configured WCL zone metadata | manual versioned override |
| Public detailed combat logs | Warcraft Logs | none | unavailable |
| Parse/profile aggregation | Warcraft Logs | none | unavailable |
| Current/prior Mythic+ profile | Blizzard | Raider.IO | local durable history |
| Historical rank/cutoff | Blizzard leaderboard/local history | Raider.IO | manual research dataset |
| Verified account characters | Blizzard OAuth account profile | none | no public inference |
| Ability/mechanic IDs | Blizzard static game data + audited in-game/WCL evidence | curated catalog | manual versioned entry |

Raider.IO MUST remain optional for publication unless a documented feature cannot be produced from Blizzard, WCL, or local history.

## 2. Warcraft Logs

### 2.1 Authentication and access

Use the public/client GraphQL endpoint with application credentials for public reports. Private or unlisted access MUST NOT be assumed. Unlisted report codes are sensitive and MUST NOT be exposed through caches or public diagnostics.

Archived reports can make event/table/graph data inaccessible without archive access. Such a report is an invalid detailed-evidence candidate and triggers fallback selection.

### 2.2 Character profile and rankings

Current repository operations include:

- `ResolveCharacter`
- `CharacterZoneRankings`
- `CharacterZoneRankingAggregates`
- `CharacterZoneRankingsPointsAndDamage`
- `CharacterRecentReports`

The `zoneRankings` result is JSON and must pass a versioned adapter. A null, changed, or unsupported shape is not equivalent to an empty valid result.

Persist for every ranking payload:

- zone ID;
- partition ID or explicit current partition;
- metric;
- compare mode;
- bracket behavior;
- character identity;
- response hash;
- adapter version;
- fetched time;
- WCL data state and visibility.

Useful current fields include:

- global score;
- total displayed/logged runs;
- best DPS percentile average;
- median DPS percentile average;
- per-dungeon best/median percentages;
- keystone level/bracket;
- spec ranks;
- best DPS;
- report/fight references in parse-style rows where available.

The displayed run count is contextual only. It MUST NOT be presented as the number of detailed runs analyzed by M+ Trust Factor.

### 2.3 Report metadata

`ReportWithFightAndMasterData` provides:

- report code, title, revision, start/end;
- visibility and zone;
- fights and keystone level;
- friendly player IDs;
- report actors, pets, classes/spec subtypes;
- ability IDs.

Report revision is part of cache compatibility. A revision change invalidates normalized evidence for that report/fight.

### 2.4 Events and tables

Supported detailed event categories in the repository include:

- Casts;
- HostileCasts through enemy-hostility filters;
- Interrupts;
- Deaths;
- DamageTaken;
- DamageDone;
- Buffs;
- Debuffs;
- Dispels;
- Healing;
- CombatantInfo.

WCL events are paginated. The API allows multiple fight IDs, source/target filters, time ranges, hostility, ability filters, query-language filters, and optional resource snapshots. Resource inclusion is bandwidth-heavy and MUST only be requested by consumers that need health-state reconstruction.

`Report.table` SHOULD be probed for aggregate-only needs such as group damage taken, total casts, or summary volumes. Event calls remain required for temporal Phase 2 analysis.

### 2.5 Rate budget

`rateLimitData` exposes:

- `limitPerHour`;
- `pointsSpentThisHour`;
- `pointsResetIn`.

The planner MUST:

- read a recent account-global snapshot;
- estimate planned cost;
- reserve budget before detailed fan-out;
- stop/defer before partial publication;
- record measured or explicitly estimated cost per logical dataset;
- never coerce unknown cost to zero.

### 2.6 Frozen and mutable data

A WCL zone marked frozen can be cached indefinitely at the zone/ranking level. Report events are documented as mutable and may change; report revision and payload fingerprints therefore remain mandatory even for old content.

## 3. Blizzard

### 3.1 Public profile APIs

Use application credentials for public character profile data. Relevant endpoints/concepts:

- character profile;
- specializations/talents;
- equipment;
- character achievements;
- Mythic Keystone profile index;
- Mythic Keystone season profile.

The current repository already implements profile, equipment, talents, current season authority, and seasonal Mythic+ runs.

### 3.2 Game data APIs

Use for:

- season index and details;
- period index;
- dungeon index/details;
- realm catalog;
- leaderboard data where available;
- static achievements/spells/items when needed.

Season IDs and active dungeon pool MUST come from an authoritative Blizzard binding. Product naming such as `midnight-season-1` is separate from the provider season ID.

### 3.3 Achievements and elite titles

Maintain a versioned catalog of achievement IDs corresponding to seasonal 0.1% titles or other accepted elite signals.

Character achievement responses can reflect account-wide presentation rules. Persist evidence as a state, not a naive boolean:

- `CHARACTER_CONFIRMED`;
- `ACCOUNT_VISIBLE`;
- `NOT_COMPLETED_CONFIRMED`;
- `UNKNOWN_OR_HIDDEN`.

Store achievement ID, completion timestamp/criteria, fetch timestamp, and catalog version.

### 3.4 Verified account characters

Account-level character discovery requires user-authorized OAuth and the appropriate WoW profile scope. Public heuristics MUST NOT link characters to the same account.

Account-linked scoring remains private unless the user explicitly chooses exposure consistent with product privacy policy.

## 4. Raider.IO

Potential uses:

- prior-season or historical rank fields not reliably available elsewhere;
- season cutoffs;
- leaderboard capacity;
- high-key distribution bootstrapping;
- historical top class/spec positioning.

Constraints:

- optional feature flag;
- bounded rate/concurrency;
- attribution on public-facing use;
- commercial-use review before monetization;
- provider failure must not prevent WCL/Blizzard scoring unless the selected feature is marked mandatory;
- no undocumented scraping.

Raider.IO profile fields and season aliases change over time. Use explicit field lists, schema validation, and a versioned adapter.

## 5. Provider result envelope

Every provider result MUST expose or be mapped to:

```ts
type ProviderEnvelope<T> = {
  data: T;
  provider: "BLIZZARD" | "WARCRAFT_LOGS" | "RAIDER_IO";
  endpointKey: string;
  requestFingerprint: string;
  fetchedAt: string;
  expiresAt: string | null;
  statusCode: number | null;
  cacheHit: boolean;
  retryCount: number;
  costUnits: number | null;
  schemaVersion: string;
  payloadHash: string | null;
  artifactId: string | null;
  providerDataState: string;
  warnings: string[];
};
```

Unknown fields remain unknown. The adapter MUST NOT invent defaults that affect scoring.

## 6. Failure semantics

| Failure | Required behavior |
|---|---|
| Character not found | fail identity bootstrap; no scoring |
| WCL hidden/private | no detailed dimensions; confidence/publication rules apply |
| WCL archived/gated | reject candidate and try fallback |
| WCL schema changed | mark adapter unsupported; no empty-success |
| Event pagination truncated | dimension validity false for affected consumer |
| Blizzard prior season missing | distinguish confirmed absence from provider failure |
| Raider.IO unavailable | omit optional metric and lower confidence where relevant |
| Rate budget insufficient | defer whole detailed plan; do not publish partial V2 score |

## 7. Authoritative references

- Warcraft Logs GraphQL schema: `https://www.warcraftlogs.com/v2-api-docs/warcraft/`
- WCL Report: `https://www.warcraftlogs.com/v2-api-docs/warcraft/report.doc.html`
- WCL RateLimitData: `https://www.warcraftlogs.com/v2-api-docs/warcraft/ratelimitdata.doc.html`
- WCL Zone: `https://www.warcraftlogs.com/v2-api-docs/warcraft/zone.doc.html`
- Blizzard WoW Profile APIs: `https://community.developer.battle.net/documentation/world-of-warcraft/profile-apis`
- Blizzard WoW Game Data APIs: `https://community.developer.battle.net/documentation/world-of-warcraft/game-data-apis`
- Blizzard OAuth: `https://community.developer.battle.net/documentation/guides/using-oauth`
- Raider.IO API: `https://raider.io/api`

All endpoint shapes MUST still be verified by contract tests and sanitized live probes.
