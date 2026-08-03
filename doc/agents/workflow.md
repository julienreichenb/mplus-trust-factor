# Agent workflow

1. Confirm worktree + branch for the assigned task.
2. Read [`AGENTS.md`](../../AGENTS.md) and [`doc/README.md`](../README.md).
3. Read the task prompt you were given (not a historical pack in the repository).
4. Inspect code; treat docs as evidence, not authority when they conflict.
5. Plan briefly, execute, test, commit on the assigned branch.
6. Handoff with commands run, results, deviations, and follow-ups.
7. Do not merge unless the prompt explicitly requires it.

## Git policy

- Feature worktree → PR / fast CI → `main`.
- Promote when ready: `pnpm promote:test` (`main` → `test` → CD). See [`../operations/release-promotion-flow.md`](../operations/release-promotion-flow.md).
- No production deploys from feature branches.

## Validation (typical)

- `pnpm lint`
- `pnpm typecheck`
- Narrowest relevant tests for touched areas
- `pnpm check:english` when UI copy changes
- `pnpm abilities:validate` when ability catalog sources change
