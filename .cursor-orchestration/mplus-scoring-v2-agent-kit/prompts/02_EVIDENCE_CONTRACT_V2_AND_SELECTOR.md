---
purpose: cursor-agent-implementation-prompt
project: mplus-trust-factor
repository: julienreichenb/mplus-trust-factor
generated: 2026-08-01
---


# Prompt 02 — Evidence Contract V2 and deterministic 2×dungeon selector

## Dependencies

- Prompt 01 accepted.
- No concurrent agent may edit the same contracts/scoring selection files.

## Objective

Implement pure, provider-free contracts and selection logic for one immutable manifest with two slots per active dungeon.

## Allowed scope

Prefer:

- `packages/contracts/src/`
- `packages/scoring/src/selection/`
- focused tests/fixtures
- `docs/scoring-v2/`

Do not add provider calls, DB migrations, queue changes, or public scoring changes.

## Required contracts

Implement versioned types/schemas for:

- candidate metadata;
- candidate rejection;
- manifest;
- manifest slot;
- dimension validity;
- coverage state;
- selector diagnostics;
- content hash input;
- season/spec/role scope.

## Selector requirements

- active dungeon pool supplied explicitly;
- two distinct report/fight slots per dungeon;
- key level descending;
- timer/score/completeness/date and stable lexical tie-breakers;
- parse/behavior/label forbidden from ordering;
- deterministic regardless of input order;
- rejected candidates retained as bounded summaries;
- supports fewer than two valid logs honestly;
- expected slot count derived from dungeon count;
- no hardcoded eight;
- content hash deterministic;
- frozen output deeply immutable at the boundary.

## Compatibility

Add adapters from current candidate/run structures only if they do not introduce provider dependencies.

Do not remove V1 selectors yet.

## Tests

At minimum:

- 2×8 full selection;
- fallback to lower key;
- hidden/archived/wrong season/wrong spec rejected;
- duplicate report/fight rejected;
- parse value changes do not affect selection;
- stable ties;
- input order invariance;
- sparse season;
- non-eight dungeon pool;
- hash mutation coverage;
- cross-dimension manifest parity.

## Validation

Run:

- focused tests;
- `pnpm lint`;
- `pnpm typecheck`;
- `pnpm test`;
- `pnpm test:contract`;
- `pnpm build`.

Stop at a distinct checkpoint commit. Do not wire into refresh, DB, calibration, deployment, or feature flags.
