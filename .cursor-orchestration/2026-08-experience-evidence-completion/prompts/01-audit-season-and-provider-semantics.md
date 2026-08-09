# Agent 01 — Audit Dynamic Season + Historical Provider Semantics

## Goal

Before changing behavior, prove exactly how the repository determines:

1. current real Mythic+ season;
2. previous real Mythic+ season;
3. Raider.IO season identity;
4. previous-season character score;
5. previous-season regional class rank;
6. native population cutoffs.

Diagnose Wallidrixe's `PREVIOUS_EVIDENCE_UNAVAILABLE` using real authoritative paths.

## Mandatory reads

Trace at least:
- canonical season authority;
- active M+ season authority / SeasonDungeon bindings;
- Experience season bootstrap;
- Blizzard season index/detail/profile calls;
- Raider.IO static seasons;
- Raider.IO character profile field construction + normalization;
- Raider.IO season cutoffs;
- provider-result persistence;
- `buildExperiencePhase1Result`.

## Dynamic season audit

Answer precisely:

- Does every scoring/recalculate path ultimately use the existing Blizzard `current_season` authority?
- Is any Experience path still relying on:
  - hard-coded Midnight S1;
  - a fixed Blizzard season ID;
  - a fixed RIO season slug;
  - `seasonId - 1`;
  - worker-start-only metadata that can become stale during a live season rollover?
- What happens if the worker starts in season N and remains alive when season N+1 begins?
- What exact DB state changes when canonical current season changes?

Construct a provider-free future-season test case with invented IDs/slugs/dates and prove current->previous rollover is algorithmic.

## Raider.IO "real season" audit

The product explicitly rejects intermediate/event seasons such as Break the Meta / pre-patch-like periods as the previous Experience season.

Inspect official Raider.IO docs/contracts available to the repository and provider code. If internet/docs are available, use primary Raider.IO documentation rather than assumptions.

Determine:
- what `current:previous` means for score fields;
- what `previous_mythic_plus_ranks` means;
- whether either field can point at an event/intermediate period;
- whether exact-season score/rank can be requested by slug;
- how static season rows identify canonical real seasons;
- whether current regex/date heuristics are sufficient or only accidental.

Do not implement a fix until the semantics are documented.

## Native cutoff audit

Report the raw/native cutoff identity returned by Raider.IO and how the current normalization changes it.

Specifically identify whether `p999/p990/p900/p750/p600` are:
- provider-native keys;
- a repository-created subset;
- stable API contract;
- enough for the desired Experience bands.

Identify where current percentile interpolation / custom `topPercent` abstraction occurs.

## Wallidrixe runtime evidence

For Wallidrixe-Archimonde EU, report:
- canonical current Blizzard season;
- selected previous Blizzard season;
- both start/end dates;
- exact Raider.IO season matched to that previous season;
- exact raw/normalized Blizzard previous rating response/failure;
- exact raw/normalized RIO previous score and season slug;
- exact previous regional class rank source and whether season identity is provable;
- population cutoff policy currently persisted;
- elite evidence state;
- exact reason Experience ends unavailable.

## No behavior changes except diagnostic/test scaffolding

Do not:
- change scoring formula;
- create persistence yet;
- touch P/S/U;
- hard-code current live season.

## Deliverable

Update handoff with:
- proven root cause(s);
- authoritative current/previous season algorithm;
- exact Raider.IO semantics;
- recommended minimal implementation for Agents 02–04;
- unresolved provider questions.

Commit only useful audit/tests/docs.
Stop.
