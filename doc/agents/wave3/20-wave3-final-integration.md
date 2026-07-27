# Agent 20 — Wave 3 final integration

## Branch

`integration/wave3`

## Inputs

Read all Wave 3 research, plan and agent handoffs. Merge only completed, committed agent branches.

## Tasks

1. Reconcile contracts and merge Agents 11–17 without dropping fixture behavior.
2. Verify the sole product flow:

```text
exact search → refresh queue → Blizzard identity → optional Raider.IO/WCL enrichments
→ explainable score → persisted snapshot → API profile → Vue detail
```

3. Run fixture acceptance suite from a clean database.
4. Run failure/partial-provider scenarios.
5. With explicit operator approval and local secrets, run one bounded live smoke identity through the full flow.
6. Inspect browser network traffic, server logs and persisted provider metadata for secret leakage.
7. Confirm Raider.IO attribution is visible.
8. Confirm no hidden/no-log WCL state directly penalizes score.
9. Confirm no stale static season/zone/expansion constant is silently accepted.
10. Update:
   - `doc/release/known-limitations.md`
   - `doc/release/acceptance-matrix.md`
   - `doc/agents/20-wave3-final-integration.md`
   - root README local/live setup.
11. Commit and stop. Do not push or merge to `main` automatically.

## Required checks

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:contract
pnpm test:data-quality
pnpm test:security
pnpm test:failure
pnpm test:e2e
pnpm build
pnpm openapi:generate
```

## Final handoff must state

- commit hash,
- exact test counts,
- live smoke identity redacted or operator-approved,
- provider calls made and cache behavior,
- partial-provider results,
- score inputs and confidence,
- secret-leak inspection result,
- legal/terms blockers,
- remaining limitations,
- rollback instructions.
