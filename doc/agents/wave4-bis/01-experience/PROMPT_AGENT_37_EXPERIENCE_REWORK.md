# Agent 37 Prompt — Experience Dimension Audit and Rework

You are responsible for auditing and redesigning the Experience dimension of M+ Trust Factor.

Work on:

- branch: `agent/wave4.3-experience`
- base: `integration/wave4.3`

The persistence hardening work through commit `c47c339` is already part of the baseline.

## Product context

The current Trust Score is:

- Performance: 35%
- Survival: 30%
- Utility: 25%
- Experience: 10%

Confidence and Authenticity are separate.

The public Experience dimension currently represents CHARACTER_HISTORY only.

Do not infer or expose account-wide rerolls/alts before Battle.net account ownership is authenticated and an explicit product policy exists.

Utility remains experimental and must not be integrated by this task.

## Objective

First explain exactly how Experience works today, then redesign it into a defensible measure of Mythic+ experience rather than performance.

Experience must answer:

> How much relevant Mythic+ context has this character accumulated, independently of how well the character performed?

Do not reward the same signal twice through both Performance and Experience.

## Phase 1 — Exact current-state audit

Inspect the repository and document:

- current Experience observations;
- formula and curves;
- provider sources;
- current-season and historical-season inputs;
- database entities;
- model versioning;
- freshness and invalidation;
- missing-data behavior;
- confidence handling;
- public explanation payload;
- tests and fixtures;
- every provider call reachable from Experience;
- every place where Experience can become unavailable or disappear.

Reference concrete files, functions, metrics and entities.

Produce a worked example for Wallidrixe using persisted data.

Do not redesign before completing the audit.

## Phase 2 — Define Experience semantics

Propose a clear conceptual model separating experience from skill/performance, survival, utility and account ownership/authenticity.

Evaluate candidate components such as:

- current-season participation depth;
- multi-season continuity;
- dungeon breadth;
- unique active-season dungeons completed;
- breadth across meaningful key-level bands;
- recency of relevant activity;
- consistency of participation over time;
- role/spec history where supported;
- historical high-key exposure;
- gaps and inactivity.

These are candidates, not mandatory requirements. Keep only components supported by reliable data and that do not duplicate Performance.

Explicitly reject vanity metrics that inflate through raw spam without meaningful breadth.

## Phase 3 — Source consolidation

Audit the feasibility and cost of:

- Blizzard character/profile APIs;
- Blizzard Mythic+ season/profile endpoints;
- Raider.IO;
- Warcraft Logs aggregate rankings;
- persisted WCL run metadata;
- local score history.

For each input, document authority, freshness, historical depth, API cost, availability, failure modes and whether a detailed WCL event call is required.

Experience should avoid detailed WCL combat-event calls.

Preferred rule:

> Experience should be calculable from durable aggregate/profile/run metadata and should not require expensive combat-log ingestion.

Reuse persisted data before fetching providers.

## Phase 4 — Character and account separation

Design two explicit concepts.

### Public Character Experience

- calculable without authentication;
- based only on the requested character;
- safe to display publicly;
- no hidden alt/reroll inference.

### Future Verified Account Experience

- only available after Battle.net account linking;
- based on characters the user has proven they own;
- private by default;
- not automatically mixed into the public Trust Score;
- prepared as a future extension, not implemented as a hidden shortcut.

Document how IAM may extend Experience without changing current public semantics.

## Phase 5 — Model design

Create an offline Experience V2 experiment.

Requirements:

- 0–100 scale;
- 50 has an explicit meaning;
- no population percentile unless the denominator is authoritative and reproducible;
- no class-specific logic;
- no reward for alts;
- small samples affect confidence;
- stale history does not disappear abruptly;
- old seasons may decay but remain valuable;
- a new character can legitimately have low Experience without being invalid;
- confirmed absence of history differs from provider failure;
- missing provider data preserves last-known-good published Experience.

Keep raw component values and explanations.

## Phase 6 — Confidence

Separate Experience score, evidence coverage and confidence.

Confidence should consider season coverage, provider completeness, historical depth, source agreement, recency and persisted-data compatibility.

A provider outage must not convert a valid Experience score into UNAVAILABLE.

## Phase 7 — Persistence and versioning

Use the existing publication architecture.

Implement deterministic observations, schema/analysis/model versions, source fingerprints, providerDataAsOf and local recalculation from persisted observations.

Do not create a parallel snapshot system.

A model-only recalculation must not call providers when compatible observations exist.

## Phase 8 — Calibration

Build an offline panel containing:

- a new character with little history;
- an active current-season character;
- a long-term multi-season character;
- a returning veteran;
- many low keys;
- fewer high keys;
- incomplete provider data;
- provider failure with last-known-good data.

Do not tune to named-character expectations.

Provide ablations for every component.

## Required tests

1. Current Experience behavior is captured before replacement.
2. Experience does not use detailed WCL combat-event calls.
3. New character with little history receives a valid low-confidence result.
4. Provider failure preserves last-known-good Experience.
5. Model-only recalculation performs zero provider calls.
6. Multi-season history increases experience without duplicating Performance.
7. Raw spam in one dungeon cannot dominate breadth.
8. Old history decays gradually rather than disappearing.
9. Public score never includes unauthenticated alts.
10. Missing data and confirmed no history are distinct.
11. Coherence validation prevents Experience disappearance.
12. Full build and tests pass.

## Deliverables

Return:

1. exact current-state explanation;
2. current formula and source map;
3. weaknesses and overlap analysis;
4. proposed Experience V2 semantics;
5. source-consolidation matrix;
6. formulas and component weights;
7. confidence model;
8. before/after calibration panel;
9. migration and versioning plan;
10. API/provider-call impact;
11. files changed;
12. tests;
13. commit hash.

Do not change the global Experience weight of 10%.
Do not integrate account-wide alts into the public score.
Do not implement Battle.net OAuth in this task.
