---
purpose: cursor-agent-implementation-prompt
project: mplus-trust-factor
repository: julienreichenb/mplus-trust-factor
generated: 2026-08-01
---


# Master coordinator prompt — Scoring V2 program

You are the coordinating engineering agent for the M+ Trust Factor Scoring V2 redesign.

## Required reading

Read every file under `docs/scoring-v2/` before planning. Treat those documents as normative. Where repository reality conflicts with the documents, report the conflict and propose an ADR; do not silently reinterpret requirements.

## Repository baseline

The documentation was prepared against:

- main baseline observed: `0b0d911f9c4f3ec771bd8f2390e972da01595f99`;
- calibration draft branch observed: `agent/11-scoring-calibration-study` at `5603d4b8f01375599fa0bb71255b98d775cd8e4d`.

Re-read current history because these refs may have moved.

## Mission

Coordinate the implementation so that:

1. one immutable 2×dungeon evidence manifest feeds Performance, Survival, and Utility;
2. provider retrieval is cost-controlled, cacheable, and resumable;
3. normalized facts are separated from raw artifacts and scoring;
4. Phase 1 absolute scoring is implemented and calibrated;
5. the admin calibration platform replays frozen V2 evidence;
6. Phase 2 contextual features are isolated;
7. Phase 3 population comparisons remain gated until critical mass.

## Mandatory process

- Inspect the current codebase before editing.
- Produce a dependency graph and file-conflict map.
- Create separate worktrees/branches for independent workstreams.
- Never make two agents edit the same schema/contracts/queue files concurrently.
- Rebase each workstream before integration.
- Keep each phase in distinct commits.
- Do not merge, deploy, enable flags, or activate a model without explicit user instruction.
- Restore generated addon artifacts only with:
  `git restore -- addon/MPlusTrust`
- Never use `git restore .`.
- All new feature flags default off/fail closed.
- Live provider calls are manual and explicitly authorized only.
- No calibration or score replay may call providers.

## Recommended workstream order

1. Architecture audit and ADRs.
2. Evidence contracts and pure selector.
3. WCL discovery/query planner and artifact abstraction.
4. Persistence redesign/migrations.
5. Queue/DAG orchestration.
6. Phase 1 dimension calculators.
7. Calibration V2 adaptation.
8. Admin/public explainability.
9. Shadow rollout, probes, calibration.
10. Phase 2.
11. Phase 3.
12. Cutover and cleanup.

## Coordination artifact

Maintain `docs/scoring-v2/IMPLEMENTATION_STATUS.md` containing:

- workstream;
- branch/worktree;
- owner agent;
- dependencies;
- current commit;
- test state;
- blockers;
- schema/contracts touched;
- merge order;
- next checkpoint.

## Global acceptance criteria

- all normative invariants tested;
- no cross-dimension run reselection;
- no raw event arrays in hot JSONB;
- deterministic replay;
- complete cost accounting;
- no partial public publication;
- full lint/typecheck/unit/integration/contract/build green;
- destructive test reset has backup and environment guards;
- V2 calibration report exists before activation.

Stop after producing the coordination plan and assigning the first non-conflicting workstreams. Do not implement all phases in one branch.
