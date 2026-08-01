---
purpose: cursor-agent-implementation-prompt
project: mplus-trust-factor
repository: julienreichenb/mplus-trust-factor
generated: 2026-08-01
---


# Prompt 09 — Experience V3 Phase 1

## Dependencies

- Blizzard provider contracts for prior season and achievements.
- Historical rank source decision.
- Can proceed partly in parallel with WCL dimensions if shared contracts are coordinated.

## Objective

Extend current Experience V2 with previous-season strength and elite history, provider-state-safe.

## Components

- current durable exposure 45%;
- previous-season strength 30%;
- elite achievement/title history 15%;
- exceptional historical rank 10%.

All coefficients versioned/calibratable.

## Provider behavior

- Blizzard primary for season profile and achievements;
- local history fallback;
- Raider.IO optional for historical ranks/cutoffs;
- distinguish confirmed absence, unknown, provider failure, partial;
- no public account-link inference.

## Catalogs/policies

Implement versioned:

- elite achievement catalog;
- previous-season normalization policy;
- historical-rank policy.

## Phase 2 boundary

Verified linked-character boost is not implemented here. Define contracts only if necessary; keep disabled.

## Tests

- previous score present;
- confirmed no activity;
- provider failure;
- account-visible achievement ambiguity;
- multiple titles diminishing;
- historical rank optional;
- missing optional components renormalize correctly;
- no WCL dependency;
- no current Performance leakage;
- deterministic explanation.

Run full validation. Stop at checkpoint. No live calls/deploy/activation.
