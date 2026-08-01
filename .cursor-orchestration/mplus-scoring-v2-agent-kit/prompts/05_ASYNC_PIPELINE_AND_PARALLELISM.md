---
purpose: cursor-agent-implementation-prompt
project: mplus-trust-factor
repository: julienreichenb/mplus-trust-factor
generated: 2026-08-01
---


# Prompt 05 — Asynchronous V2 pipeline, fan-out/fan-in, and resumability

## Dependencies

- V2 contracts and persistence merged/rebased.
- WCL planner available.
- Coordinate with any queue-priority/concurrency work; do not overlap blindly.

## Objective

Introduce the V2 orchestration DAG behind disabled feature flags.

## Scope

- worker contracts;
- queue names/payloads;
- processors;
- orchestration;
- repositories;
- tests;
- API status diagnostics as needed.

Do not change public score behavior.

## Required flow

1. Blizzard identity gate.
2. Concurrent provider summary/history discovery.
3. candidate reconciliation.
4. metadata hydration/fallback.
5. manifest freeze.
6. rate-budget plan/reservation.
7. fan-out one job per selected slot.
8. dataset/artifact/fact-set processing.
9. fan-in after all expected slots terminal.
10. provider-free dimension aggregation placeholder.
11. publication remains disabled/shadow.

## Queue requirements

- dedicated V2 slot queue or approved versioned analyze queue;
- deterministic dedupe keys;
- terminal redelivery no-op;
- compare-and-set claims;
- cancellation between pages;
- graceful shutdown;
- per-character fairness;
- bounded WCL concurrency independent of job count;
- calibration queue isolation.

## Failure behavior

- reusable completed artifacts survive;
- retries fetch only missing compatibility keys;
- insufficient budget defers whole plan;
- no partial public score;
- newer refresh supersedes old batch safely;
- admission reservation released exactly once.

## Feature flags

Add disabled/fail-closed flags defined in rollout docs. Readiness reports incompatible flag combinations.

## Tests

- 16-slot fan-out;
- deterministic fan-in;
- partial slot statuses;
- redelivery/concurrent workers;
- cancellation;
- supersession;
- rate defer;
- DB/Redis failures;
- worker shutdown;
- provider-free finalizer;
- no public pointer mutation;
- no coupling to calibration.

Full validation required. Stop after shadow orchestration checkpoint. Do not enable or deploy.
