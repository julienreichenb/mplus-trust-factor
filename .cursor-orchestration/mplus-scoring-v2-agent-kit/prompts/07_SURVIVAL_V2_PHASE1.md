---
purpose: cursor-agent-implementation-prompt
project: mplus-trust-factor
repository: julienreichenb/mplus-trust-factor
generated: 2026-08-01
---


# Prompt 07 — Survival V2 Phase 1

## Dependencies

- V2 slot fact pipeline.
- Ability catalog availability interface.
- Existing Survival V1.1.1 audited for reusable logic.

## Objective

Adapt Survival to the shared two-run manifest and normalized facts, preserving pressure-cluster strengths while removing independent run selection.

## Required components

- outcome/deaths;
- defensive activation volume normalized by active combat;
- emergency recovery in eligible danger windows;
- relative avoidable damage shadow-only.

Production candidate weights:

- 50/25/15/10 when relative damage active;
- renormalized 55/30/15 while relative damage shadow/off.

## Required behavior

- no Survival-specific run selection;
- median per dungeon, equal dungeon mean;
- health/resource evidence modes;
- no potion availability assumptions;
- no raw damage fairness claims without catalog;
- toolkit availability states;
- bounded fact documents;
- explicit limitations.

## Relative damage shadow

Implement diagnostics only:

- tank exclusion;
- non-tank group median;
- self/mandatory damage exclusions;
- reliability state;
- zero public contribution.

## Tests

- deaths mapping;
- no danger windows;
- defensive/self-heal availability;
- truncated health data;
- pressure-cluster dedupe;
- two-run aggregation;
- relative damage unreliability;
- same manifest as other dimensions;
- no provider calls;
- V1 parity where intended;
- deterministic replay.

Full validation. Stop at checkpoint. No activation/deploy.
