---
purpose: cursor-agent-implementation-prompt
project: mplus-trust-factor
repository: julienreichenb/mplus-trust-factor
generated: 2026-08-01
---


# Prompt 01 — Architecture audit, conflict map, and ADRs

## Objective

Audit the current repository against `docs/scoring-v2/` and produce an implementation-ready architecture plan before runtime changes.

## Scope

Read-only code audit plus documentation changes under:

- `docs/scoring-v2/`
- optional `doc/architecture/adr/`

Do not modify application code, Prisma schema, contracts, queues, scoring formulas, or feature flags.

## Required audit

Map current implementation for:

- WCL discovery, hydration, events, shared evidence, cost accounting;
- Blizzard and Raider.IO provider capabilities;
- run selection for Performance/Survival/Utility;
- refresh pipeline and BullMQ topology;
- persistence models and raw payload handling;
- Performance, Survival, Utility, Experience calculations;
- confidence/publication flow;
- calibration draft architecture and branch divergence;
- feature flags/readiness;
- current tests and fixtures.

## Deliverables

1. `docs/scoring-v2/IMPLEMENTATION_BASELINE.md`
2. `docs/scoring-v2/IMPLEMENTATION_DEPENDENCY_GRAPH.md`
3. ADRs for:
   - hard reset versus dual-write;
   - artifact storage abstraction;
   - queue topology;
   - Evidence Manifest V2 ownership;
   - calibration bundle V2 references;
   - V1/V2 cutover.
4. File conflict matrix identifying which prompts cannot run concurrently.
5. Proposed branch/worktree names and merge order.
6. List of assumptions requiring live probes.

## Required evidence

Cite exact repository paths and symbols. Distinguish:

- already implemented and reusable;
- implemented but semantically incompatible;
- missing;
- research-only;
- calibration-branch-only.

## Acceptance

- no unsupported claim;
- no implementation changes;
- all normative conflicts explicitly recorded;
- destructive options consider current test-only status;
- calibration PR integration is included;
- user can approve the architecture before migrations.

Run documentation lint/format checks if present. Stop after a single documentation commit. Do not push unless instructed.
