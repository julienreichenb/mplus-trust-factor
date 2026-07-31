# Agent workflow

## Stabilization programme (current)

1. Confirm worktree + branch (`agent/NN-…`).
2. Read your assigned prompt under [`.cursor-orchestration/2026-07-stabilization/standalone-prompts/`](../../.cursor-orchestration/2026-07-stabilization/standalone-prompts/) (rules, decisions and handoff template are embedded there).
3. Read [`AGENTS.md`](../../AGENTS.md) and [`doc/README.md`](../README.md).
4. Inspect code; treat docs as evidence, not authority when they conflict.
5. Plan briefly, execute, test, commit on the assigned branch.
6. Handoff using the template in your standalone prompt / programme pack.
7. Do not merge; do not delete the worktree.

Worktree commands: [`.cursor-orchestration/2026-07-stabilization/WORKTREE-COMMANDS.md`](../../.cursor-orchestration/2026-07-stabilization/WORKTREE-COMMANDS.md).

## Git policy

- Feature worktree → PR / fast CI → `main`.
- Promote when ready: `pnpm promote:test` (`main` → `test` → CD). See [`../operations/release-promotion-flow.md`](../operations/release-promotion-flow.md).
- No production deploys from feature branches.

## Historical waves

Wave 1–4.x prompts and handoffs remain under [`./`](./) (`wave3/`, `wave4/`, `wave4-bis/`, numbered handoffs). They are **historical research / handoff** material, not the stabilization entry point.

Wave-1 starter `agents/*.txt` copies are archived at [`../archive/wave1-agent-prompts/`](../archive/wave1-agent-prompts/).
