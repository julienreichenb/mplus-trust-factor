---
purpose: cursor-agent-implementation-prompt
project: mplus-trust-factor
repository: julienreichenb/mplus-trust-factor
generated: 2026-08-01
---


# Workstream map and concurrency rules

## Safe early parallelism

After Prompt 01:

- Prompt 02 Evidence contracts/selector
- Prompt 03 WCL planner/probes

These may run in parallel only with an agreed interface and no overlapping contract edits.

Prompt 09 Experience may begin in parallel later because it is mostly Blizzard/history-oriented, but contract/model-file ownership must be coordinated.

## Serialized work

These areas should be serialized:

1. Prisma schema/migrations:
   - Prompt 04
   - Prompt 10
2. Worker queues/processors:
   - Prompt 05
   - any refresh priority/concurrency work
   - Prompt 10 calibration queue wiring
3. Score model defaults/contracts:
   - Prompts 06–09
   - Prompt 10
4. Admin routes/navigation:
   - Prompt 10
   - Prompt 11

## Suggested branches

```text
docs/scoring-v2-architecture
feat/scoring-v2-evidence-contract
feat/scoring-v2-wcl-planner
feat/scoring-v2-persistence
feat/scoring-v2-pipeline
feat/scoring-v2-performance
feat/scoring-v2-survival
feat/scoring-v2-utility
feat/scoring-v2-experience
feat/scoring-v2-calibration
feat/scoring-v2-explainability
feat/scoring-v2-observability
research/scoring-v2-phase2
research/scoring-v2-reference-cohorts
chore/scoring-v2-cutover
```

## Merge order

```text
01 docs/ADRs
→ 02 contracts
→ 03 planner
→ 04 persistence
→ 05 pipeline
→ 06/07/08/09 dimensions
→ 10 calibration
→ 11 explainability
→ 12 hardening
→ shadow validation
→ 13 Phase 2
→ 14 Phase 3
→ 15 cutover
```

## Universal checkpoint response

Every agent must report:

- branch/worktree;
- commit SHA;
- files changed;
- migrations/contracts/flags added;
- behavioral changes;
- tests with exact results;
- known failures reproduced on clean main or fixed;
- unresolved decisions;
- whether push/PR/merge/deploy/activation occurred.

Default: no push, merge, deploy, flag enable, live provider call, or model activation.
