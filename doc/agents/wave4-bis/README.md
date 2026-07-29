# M+ Trust Factor — Wave 4.3 Agent Pack

This pack prepares four workstreams:

1. Rework the **Experience** dimension.
2. Implement **Battle.net OAuth and IAM**.
3. Design and implement **automatic refresh orchestration**.
4. Build a complete **CI/CD and VPS deployment foundation**.

## Current baseline

The scoring model is:

- Performance: 35%
- Survival: 30%
- Utility: 25%
- Experience: 10%
- Confidence and Authenticity are separate from the Trust Score.

Persistence and refresh hardening were implemented by Agent 36:

- initial commit: `c3cafbd`
- corrective build-safe commit: `c47c339`
- PostgreSQL is the durable source of truth.
- Published snapshots use a last-known-good publication model.
- Partial refreshes must not erase valid published dimensions.
- Public profile reads must not synchronously call external providers.
- WCL quota exhaustion must defer refresh work without making profiles UNRANKED.

Utility remains experimental and must not be integrated into production:

- cross-class fixes: `2587b14`
- panel update: `d83b39b`
- V3.1 calibration: `89d0986`
- V3.2 opportunity audit: `4c7dd4a`
- hostile NPC casts are not yet available in persisted Utility artifacts.
- Agent 35 should continue the shared Survival/Utility WCL evidence-ingestion task on its existing branch.

## Recommended execution order

### Start immediately

- Agent 37: Experience audit and rework.
- Agent 40: CI/CD and deployment foundation.

### Start after schema coordination

- Agent 38: Battle.net OAuth and IAM.

Experience and IAM may both affect Prisma. Do not let both agents independently create conflicting user/character ownership models.

### Start in audit/simulation mode immediately, activate later

- Agent 39: automatic refresh orchestration.

Production activation should wait until shared WCL evidence ingestion is available, real per-character costs are measured, the cohort definition is validated, and persistence/budget protections are confirmed at runtime.

## Branching recommendation

```text
integration/wave4.2
└── merge Agent 36 persistence hardening through c47c339
    └── create integration/wave4.3
        ├── agent/wave4.3-experience
        ├── agent/wave4.3-battlenet-iam
        ├── agent/wave4.3-refresh-orchestration
        └── agent/wave4.3-cicd-vps
```

Agent 35 remains on its existing Utility/shared-ingestion branch and should periodically merge from `integration/wave4.3` rather than being merged before Utility is production-ready.

## Common rules

- Do not change scoring weights unless explicitly approved.
- Do not integrate Utility into production during Wave 4.3.
- Do not make public profile reads depend on live provider calls.
- Do not erase the last valid published score when a refresh fails.
- Do not introduce parallel persistence, queue, IAM or budget subsystems when existing ones can be extended.
- All schema changes require a forward migration, backfill strategy and rollback notes.
- Every workstream must return build, test, migration and runtime-validation results.
