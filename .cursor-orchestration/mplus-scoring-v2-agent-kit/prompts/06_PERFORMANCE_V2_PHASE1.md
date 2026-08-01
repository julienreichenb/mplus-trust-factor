---
purpose: cursor-agent-implementation-prompt
project: mplus-trust-factor
repository: julienreichenb/mplus-trust-factor
generated: 2026-08-01
---


# Prompt 06 — Performance V2 Phase 1

## Dependencies

- Manifest/fact/pipeline foundations available.
- WCL same-key parse probe resolved for supported roles.
- No concurrent edits to scoring model defaults without coordination.

## Objective

Implement provider-free Performance V2 Phase 1 behind shadow flags.

## Inputs

- frozen manifest;
- two slots per dungeon when available;
- run parse facts;
- WCL profile aggregate facts;
- Season Difficulty Policy;
- spec/role adapter;
- evidence coverage.

## Required calculations

Implement versioned pure functions for:

- difficulty multiplier interpolation;
- adjusted parse centered on 50;
- per-dungeon peak/floor/consistency;
- equal-dungeon detailed aggregate;
- profile best/median stabilizer;
- coverage-dependent blend;
- confidence;
- explanation.

Use candidate defaults from the normative spec, but isolate all coefficients in an immutable model config and document calibration status.

## Role safety

- DPS supported only after field validation.
- Tank/healer adapters fail unavailable unless verified.
- Do not fall back to raw HPS or unscoped DPS.
- Unsupported role lowers availability/confidence rather than fabricating a score.

## Persistence

Write shadow DimensionComputation/facts with exact manifest/model/policy versions. Do not alter public ScoreSnapshot pointer.

## Calibration hooks

Export replayable Performance inputs and contributor diagnostics.

## Tests

- full/sparse manifests;
- one versus two runs;
- low/high key adjustment;
- consistency penalty;
- profile-only and detailed-only;
- partition mismatch;
- unsupported role;
- deterministic explanation;
- no selection by parse;
- no provider calls;
- score/confidence bounds.

Run full suites. Stop at a distinct commit. Do not activate flags or models.
