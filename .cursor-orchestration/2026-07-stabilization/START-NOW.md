# Start now — existing Wave 0A worktrees

The failed CLI launch already created the worktrees. Close the Cursor Agent terminal
windows; do not recreate the branches.

From the primary repository root:

```powershell
cursor -n "..\mplus-worktrees\00-foundation-ci-repair"
cursor -n "..\mplus-worktrees\01-foundation-repository-inventory"
```

Then paste into each Cursor Agent chat:

- Agent 00:
  `.cursor-orchestration\2026-07-stabilization\standalone-prompts\00-foundation-ci-repair.md`
- Agent 01:
  `.cursor-orchestration\2026-07-stabilization\standalone-prompts\01-foundation-repository-inventory.md`

The prompt files are opened from the primary repository and copied in full. They do not
need to exist inside the worktree.
