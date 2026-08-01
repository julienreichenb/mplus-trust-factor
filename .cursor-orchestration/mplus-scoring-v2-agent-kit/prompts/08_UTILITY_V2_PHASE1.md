---
purpose: cursor-agent-implementation-prompt
project: mplus-trust-factor
repository: julienreichenb/mplus-trust-factor
generated: 2026-08-01
---


# Prompt 08 — Utility V2 Phase 1 observed contribution

## Dependencies

- V2 facts and ability catalog.
- Hostile cast and player/pet attribution probes.
- Existing Utility V3.2 research reviewed.

## Objective

Implement shared-manifest Utility Phase 1 as observed-positive-contribution, not missed-opportunity scoring.

## Domains

- cast stops 45%;
- support/externals 28%;
- strategic CC 27%;
- applicable-domain renormalization;
- neutral floor 50;
- bounded contributions.

## Required facts

Classify interrupt attempts:

- confirmed success;
- valid overlap;
- matched failed;
- unmatched;
- not observable.

Add CC/support actions with semantic multipliers, active-combat normalization, dedupe, and pet ownership.

## Safety

- unmatched spam cannot produce elite score;
- no penalty below 50 without Phase 2 opportunities;
- zero evidence => 50 with low confidence;
- toolkit-inapplicable domains excluded;
- passive/rotational support receives zero/negligible credit;
- no independent run selection.

## Persistence/explanation

Write shadow dimension computation and detailed counts/rates/caps/catalog coverage.

## Tests

- success/overlap/failure/unmatched classification;
- spam caps;
- no hostile casts;
- no toolkit;
- pet attribution;
- support semantics;
- domain renormalization;
- zero contribution;
- two-run manifest aggregation;
- no provider calls;
- deterministic output.

Full validation. Stop at checkpoint. Do not activate publication.
