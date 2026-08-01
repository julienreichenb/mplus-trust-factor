---
purpose: cursor-agent-implementation-prompt
project: mplus-trust-factor
repository: julienreichenb/mplus-trust-factor
generated: 2026-08-01
---


# Prompt 12 — Observability, cost gates, and failure hardening

## Dependencies

- Shadow V2 pipeline available.

## Objective

Make provider spend, evidence quality, and partial-failure behavior observable and testable.

## Required metrics/events

Implement all events/metrics in `15_TESTING_VALIDATION_OBSERVABILITY.md`, including:

- manifest coverage/fallback;
- WCL calls/points/pages/bytes;
- cache/artifact hits;
- queue age/depth;
- slot and batch state;
- score/confidence distributions;
- V1/V2 deltas;
- publication rejections;
- artifact sizes/orphans.

## Health/readiness

Report:

- application revision;
- API/worker contract versions;
- V2 feature modes;
- WCL snapshot age/state;
- artifact backend readiness;
- queue connectivity;
- model/catalog compatibility.

Fail readiness only for conditions required by enabled modes.

## Failure injection

Add deterministic tests for:

- 429/5xx/timeouts;
- stale budget;
- pagination loop;
- schema drift;
- artifact failure;
- DB/Redis failure;
- worker death/redelivery;
- cancellation;
- concurrent finalization;
- version skew.

## Alerts/runbooks

Add operational docs for:

- budget defer/stop;
- schema unsupported;
- stuck batches;
- partial artifacts;
- version skew;
- rollback;
- destructive test reset.

## Security

Sanitize character/report identifiers and provider payloads.

Run full validation. Stop at checkpoint. No deploy/enable unless explicitly instructed.
