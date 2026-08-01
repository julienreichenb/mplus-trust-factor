---
status: proposed
normative: true
last_reviewed: 2026-08-01
repository: julienreichenb/mplus-trust-factor
baseline_main: 0b0d911f9c4f3ec771bd8f2390e972da01595f99
calibration_draft_branch: agent/11-scoring-calibration-study
calibration_draft_head_observed: 5603d4b8f01375599fa0bb71255b98d775cd8e4d
---


# Provider field and endpoint dictionary

This document describes the minimum fields required by Scoring V2. Provider adapters may receive more fields but must not silently score them.

## 1. Warcraft Logs GraphQL operations

### `ResolveCharacter`

Inputs:

- name;
- server slug;
- server region.

Expected fields:

- character ID;
- canonical ID;
- name;
- level;
- class ID;
- hidden;
- server slug/region.

Uses:

- WCL identity;
- visibility;
- canonical ID persistence;
- discovery eligibility.

### `CharacterZoneRankingsPointsAndDamage`

Inputs:

- name;
- server slug/region;
- zone ID;
- partition optional/current.

Result:

- JSON scalar from `zoneRankings`;
- ranking rows;
- throughput ranking rows;
- global score/runs/spec rank data where present.

Adapted fields:

- total Mythic+ score;
- displayed total run count;
- best DPS percentile average;
- median DPS percentile average;
- partition and zone;
- spec ranks;
- item-level filter;
- per-dungeon encounter ID/name;
- key/bracket;
- rating points/ranks for diagnostics;
- best DPS;
- best and median execution percentiles.

Scoring:

- profile Performance stabilizer;
- not detailed sample count;
- rating points and raw key level remain excluded from current profile parse score unless a later model explicitly changes this.

### `CharacterZoneRankings`

Current compare mode may return parse-style ranking rows.

Required normalized fields:

- report code;
- fight ID;
- encounter ID;
- zone ID;
- bracket/key level;
- score/amount;
- percentile;
- rankPercent;
- bracketPercent;
- specialization;
- role;
- duration;
- report/fight start times;
- timed when provable;
- metric.

Scoring V2 requires a probe to confirm which field represents same-key `key %`.

### `CharacterRecentReports`

Fields:

- report code/title;
- start/end;
- visibility;
- zone ID/name;
- pagination total/has_more_pages.

Use:

- fallback candidate discovery only;
- reports require fight/masterData hydration before selection.

### `ReportWithFightAndMasterData`

Fields:

- report code/title/revision/start/end/visibility/zone;
- fights: ID, encounter ID, name, difficulty, kill, start/end, keystone level, friendly players;
- actors: ID, name, type, subtype, server, pet owner;
- abilities: game ID/type.

Use:

- report revision;
- fight/dungeon/key validation;
- target actor and pet attribution;
- metadata batching.

### `ReportEvents`

Inputs:

- report code;
- fight IDs;
- data type;
- source;
- time range;
- limit;
- translation/ID options;
- resources;
- filter expression;
- hostility.

Result:

- event JSON array;
- `nextPageTimestamp`.

Required normalized fields by event:

#### Casts

- timestamp;
- source ID;
- target ID;
- ability game ID;
- event type when relevant.

#### Interrupts

- timestamp;
- source/target;
- interrupt ability;
- interrupted ability.

#### Deaths

- timestamp;
- target;
- killer;
- ability.

#### DamageTaken/DamageDone

- timestamp;
- source/target;
- ability;
- amount;
- resource/HP data when requested.

#### Buffs/Debuffs

- apply/remove/refresh;
- source/target;
- ability;
- stack where needed.

#### Dispels

- timestamp;
- source/target;
- dispel ability;
- dispelled ability.

#### Healing

- timestamp;
- source/target;
- ability;
- amount;
- overheal.

#### CombatantInfo

- actor/source;
- specialization;
- gear;
- talents;
- other loadout facts exposed by payload.

### `Report.table` probe targets

Potential table types:

- Summary;
- Casts;
- DamageDone;
- DamageTaken;
- Deaths;
- Dispels;
- Healing;
- Interrupts;
- Survivability.

No table field is production-authoritative until adapter/probe fixtures are added.

### `RateLimitData`

Fields:

- limit per hour;
- points spent this hour;
- seconds until reset.

Derived:

- remaining points;
- reset time;
- utilization;
- action/admission decision.

### `WorldDataZone`

Fields:

- ID/name;
- frozen;
- encounters;
- partitions.

Use:

- zone/encounter mapping;
- cache policy;
- partition compatibility.

## 2. Blizzard Profile APIs

### Character profile

Required normalized fields:

- Blizzard character ID;
- name/realm/region;
- level;
- faction;
- class;
- active specialization;
- role;
- item levels where present;
- profile URLs/media references.

### Character specializations

Required:

- active specialization;
- selected talents;
- loadout code;
- spell/talent IDs.

Use:

- toolkit availability;
- spec/role scope;
- cooldown/talent replacements.

### Character equipment

Required:

- average/equipped item level;
- items and IDs;
- optional key-item diagnostics.

Currently explanatory/contextual; not a direct core Phase 1 score input.

### Mythic Keystone profile index

Required:

- current season ID/binding;
- current Mythic+ rating;
- best run summaries where returned.

### Mythic Keystone season profile

Required:

- season ID;
- current/season rating;
- best seasonal runs:
  - dungeon/map;
  - key level;
  - completion duration;
  - completed timestamp;
  - timer state/score when available;
  - participants where available.

Blizzard seasonal profile is not a complete history of every run. It is used for canonical/high-level history and matching, not as a replacement for WCL detailed logs.

### Character achievements

Required:

- achievement ID;
- completed state;
- completion timestamp;
- criteria state;
- fetch timestamp;
- response visibility/ambiguity diagnostics.

Use:

- versioned elite title catalog.

### Account profile/OAuth

Required privately:

- durable account subject;
- character IDs/realm/name/class/level;
- ownership timestamps/status;
- granted scope;
- token expiry.

Never expose account character lists publicly by default.

## 3. Blizzard Game Data APIs

Required concepts:

- season index/current season;
- season details;
- period index/current period;
- dungeon index/details;
- realm catalog;
- Mythic+ leaderboards;
- achievement/static spell data.

Persist provider IDs and product slugs separately.

## 4. Raider.IO

Current repository minimum profile field request:

- `gear`;
- `talents`;
- `mythic_plus_scores_by_season:current:previous`;
- `mythic_plus_ranks`;
- `mythic_plus_recent_runs`;
- `mythic_plus_best_runs`.

V2 optional additions require OpenAPI verification, especially:

- historical rank/cutoff;
- highest-level runs;
- season cutoff endpoints;
- leaderboard capacity;
- static season/dungeon data.

Normalize:

- current/previous season score by role;
- rank fields with region/world/class/spec scope;
- run dungeon/key/time/score/participants;
- provider crawl/update timestamps;
- source attribution and capability state.

## 5. Null and unknown policy

For every provider field:

- null/missing is not zero;
- unsupported schema is not empty success;
- confirmed absence is distinct from unknown;
- provider failure is distinct from no activity;
- stale data retains fetched/as-of metadata;
- conflicting sources produce a disagreement record.

## 6. Payload storage policy

- small typed metadata may remain JSON in ExternalPayload;
- large WCL event/table pages become compressed RawArtifacts;
- normalized fact sets reference payload/artifact hashes;
- public API never returns raw provider payloads.
