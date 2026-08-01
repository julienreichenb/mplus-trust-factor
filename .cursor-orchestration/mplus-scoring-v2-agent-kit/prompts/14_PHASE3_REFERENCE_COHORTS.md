---
purpose: cursor-agent-implementation-prompt
project: mplus-trust-factor
repository: julienreichenb/mplus-trust-factor
generated: 2026-08-01
---


# Prompt 14 — Phase 3 reference cohorts and critical-mass gates

## Preconditions

Do not begin until explicitly authorized and Phase 2 is stable.

## Objective

Implement collection, frozen reference snapshots, eligibility gates, and shadow-only relative metrics.

## Required capabilities

- stratified slice keys;
- account/character deduplication;
- expert/external/prior-model source policy;
- critical-mass thresholds;
- fallback hierarchy;
- frozen distributions/hashes;
- drift monitoring;
- exclusion of target/self where required;
- bounded score influence;
- state machine: disabled/collecting/shadow/eligible/active/suspended.

## Anti-circularity

The current candidate model cannot choose its own S/A cohort. Enforce source-model/version checks.

## Privacy

Store aggregate distributions; do not expose member identities publicly.

## Tests

- insufficient sample;
- duplicate accounts;
- concentration cap;
- fallback;
- self exclusion;
- circular source rejection;
- drift suspension;
- bounded influence;
- missing reference no penalty;
- deterministic snapshot.

Stop at shadow-only checkpoint. Do not activate reference scoring.
