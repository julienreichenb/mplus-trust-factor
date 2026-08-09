# Agent 02 — Season Binding + Evidence Integrity Hardening

## Mission

Remove the remaining correctness hazards around exact previous-season identity and immutable Experience evidence.

This agent owns findings F2–F6.

## Read first

- `../common/GLOBAL_DIRECTIVES.md`
- `../common/REVIEW_FINDINGS.md`
- `../common/LATEST_HANDOFF.md`

Inspect at minimum:

- `apps/worker/src/orchestration/scoring/refresh-bridge.ts`
- `apps/worker/src/orchestration/scoring/experience-phase1.ts`
- `apps/worker/src/orchestration/scoring/experience-previous-season-evidence.ts`
- `apps/worker/src/orchestration/scoring/experience-season-bootstrap.ts`
- `apps/worker/src/orchestration/scoring/experience-season-population-policy-sync.ts`
- `apps/worker/src/orchestration/scoring/experience-evidence-persist.ts`
- Raider.IO exact-season provider implementation
- Season authority implementation

## Part 1 — one canonical previous-season binding

Prove the duplicate resolver identified in review.

Then remove it.

Required invariant:

> The internal previous Season row and the Raider.IO slug used for exact historical acquisition must originate from the same canonical binding decision.

Preferred result:
- `resolvePreviousMythicSeason()` or a new minimal typed wrapper returns/locates the exact previous `Season`;
- the caller does not independently query "latest prior season";
- `providerSeasonId` comes from that exact selected row;
- fixture/non-authority rows cannot provide the RIO slug for another selected season.

Add a regression fixture where:
- an invalid/fixture season starts later than the true Blizzard-authority previous season;
- the invalid row has a plausible `providerSeasonId`;
- final exact RIO acquisition still uses the true previous season's slug.

## Part 2 — persisted evidence compatibility checks

Harden durable evidence reads.

A row should be reusable only when it is compatible with the exact current resolved previous-season binding.

Validate as appropriate:
- `characterId`;
- internal `seasonId`;
- compatibility version;
- payload internal season id;
- Blizzard season id;
- Raider.IO season slug when relevant;
- source / ratingSource consistency;
- `contentHash` when present.

Do not reject legitimate older rows merely because a non-essential provenance field is null if the compatibility contract did not previously require it.

When a row is incompatible:
- with providers allowed: ignore stale row and reacquire;
- with providers forbidden: fail closed/unavailable;
- never mutate the incompatible row in place if immutability semantics prohibit it; use compatibility bump/repair strategy only if actually required.

Add regression tests for:
- mismatched Blizzard season id;
- mismatched RIO slug;
- corrupted content hash;
- correct row still replays provider-free.

## Part 3 — remapped cutoff equivalence

Current sync intentionally rejects `isRemappedSeason=true` unless exact target-season equivalence is proven.

Define a narrow typed proof based on the season binding already established by Agent 02.

Accept remapped cutoffs only if the product can prove they refer to the exact intended previous real M+ season.

Evidence may include:
- explicit matching Blizzard season id retained from RIO static data;
- provider `is_main_season=true`;
- exact bound RIO slug;
- chronology/date compatibility.

Do not simply set `exactTargetSeasonEquivalenceProven=true` unconditionally.

Add tests:
- exact Blizzard↔RIO season match + remapped cutoff -> policy can become LKG;
- ambiguous date-only / event / wrong Blizzard id -> remapped cutoff remains rejected;
- non-remapped normal cutoff behavior unchanged.

## Part 4 — ensure retry semantics

Audit `ensureExperienceSeasonBindingReady()` process-local memoization.

Do not mark a region/current season as fully ensured if the operation failed to establish the required season binding/policy due to a transient failure.

Add test:
1. first N→N+1 ensure encounters provider failure / partial bootstrap;
2. second call in same process must retry;
3. after successful ensure, subsequent call can skip.

Use existing provider cache/backoff behavior rather than inventing aggressive retry loops.

## Part 5 — Blizzard failure classification

Audit all failure types surfaced by the Blizzard historical-season call.

Separate:
- terminal/unsupported historical evidence cases for which exact-season RIO fallback is justified;
- transient failures that must remain retryable.

Do not persist immutable RIO fallback evidence after a transient Blizzard incident unless the product contract already explicitly defines that as terminal.

At minimum test:
- historical 404/known unsupported-history case -> RIO fallback allowed if exact season proven;
- 429 -> no immutable RIO fallback;
- 5xx -> no immutable RIO fallback;
- network/retryable provider error -> no immutable RIO fallback;
- successful Blizzard result always wins and never calls RIO fallback.

If the Blizzard provider error taxonomy is insufficient, make the smallest typed change needed. Do not redesign all provider errors.

## Do not

- do not implement previous-season class rank from an unproven source;
- do not retune native cutoff scores;
- do not touch P/S/U;
- do not add frontend code.

## Validation

Run focused tests and all Experience suites touched by the changes.

Update `LATEST_HANDOFF.md` with:
- canonical binding before/after;
- evidence compatibility contract;
- remapped cutoff proof definition;
- retry behavior;
- Blizzard terminal vs transient fallback rules;
- files/tests;
- commit SHA;
- open issues for Agent 03.

Commit and stop.
