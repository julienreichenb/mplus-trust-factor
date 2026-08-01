---
purpose: cursor-agent-implementation-prompt
project: mplus-trust-factor
repository: julienreichenb/mplus-trust-factor
generated: 2026-08-01
---


# Prompt 03 — WCL discovery, query planner, cost model, and probes

## Dependencies

- Evidence contracts available or mocked by an agreed interface.
- No concurrent modification of WCL provider core files.

## Objective

Build a planner that determines exactly which WCL operations/datasets are needed for a manifest without changing public scoring.

## Scope

- `packages/providers/warcraftlogs/`
- `tools/scripts/wcl-*`
- focused contracts if coordinated
- docs/probe outputs excluded from Git when containing live identities.

No Prisma migration or worker queue integration in this prompt.

## Required work

### Discovery plan

- combine zone rankings, parse-style rows, recent reports, and persisted WCL sources;
- retain bounded candidates per dungeon;
- expose fallback depth and rejection reasons;
- lazy report hydration grouped by report code.

### Dataset plan

- union datasets across enabled Performance/Survival/Utility consumers;
- deterministic compatibility keys;
- include hostility, resource mode, filters, actor, time range, report revision;
- no duplicate logical fetch.

### Cost plan

- estimate cost by operation/page;
- expose unknown distinctly from zero;
- plan cache/persisted hits;
- emit total/safety margin;
- integrate with existing WCL rate budget types without enabling new admission behavior.

### Probes

Create manual, sanitized probes for:

- exact same-key parse field;
- metadata batching by multiple fight IDs;
- event versus table aggregate parity;
- cost and bytes per dataset;
- archived/gated behavior;
- tank/healer ranking payload shapes.

Probes MUST require explicit live-provider environment guards and MUST NOT run in standard CI.

## Tests

- planner deterministic;
- dataset union;
- compatibility key semantics;
- cache-hit cost removal;
- unknown cost;
- pagination estimates;
- batched metadata plan;
- no provider execution from pure planner tests;
- sanitized output.

## Deliverables

- planner API;
- fixtures;
- probe scripts/runbooks;
- evidence/cost audit report template.

Run full validation and stop at a checkpoint commit. No live calls unless explicitly authorized. No deploy/merge/flag enable.
