# Cursor IDE workflow — no Agent CLI, no launch scripts

Extract this folder at the root of the primary repository:

```text
mplus-trust-factor/
  .cursor-orchestration/
    2026-07-stabilization/
      standalone-prompts/
```

Keep it local/untracked.

## Working method

For each agent:

1. Create its Git worktree from the current `origin/main`.
2. Open the worktree in a separate Cursor window:
   ```powershell
   cursor -n "..\mplus-worktrees\<worktree-folder>"
   ```
3. In that Cursor window, open Agent mode.
4. From the primary repository, open the matching file under
   `.cursor-orchestration\2026-07-stabilization\standalone-prompts\`.
5. Copy the complete file and paste it into Agent mode.
6. Let the agent work only in the opened worktree.
7. When finished, send ChatGPT:
   - agent number;
   - full final response;
   - `git status --short`;
   - `git log -1 --stat`;
   - `git diff --name-status origin/main...HEAD`;
   - test/CI evidence.

Do not merge before review.
