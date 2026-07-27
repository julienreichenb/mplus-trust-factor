# ADR 0004 — BullMQ + Redis for async work

## Status

Accepted

## Context

Character refresh, detailed log analysis, score recalculation, and addon export are long-running and must respect provider budgets.

## Decision

Use Redis + BullMQ with named queues and typed Zod-validated payloads defined in `@mplus/contracts`.

## Consequences

- API stays responsive; workers own provider I/O.
- Dedupe helpers prevent duplicate expensive work.
- Agent 5 implements real processors; Agent 0 ships NotImplemented skeletons.
