# Worktree and Cursor commands

Run from the primary repository root.

Before every new wave:

```powershell
git switch main
git pull --ff-only origin main
git fetch origin
New-Item -ItemType Directory -Force '..\mplus-worktrees' | Out-Null
```

## Wave 0A

### Agent 00

```powershell
git worktree add -b "agent/00-foundation-ci-repair" "..\mplus-worktrees\00-foundation-ci-repair" origin/main
cursor -n "..\mplus-worktrees\00-foundation-ci-repair"
```

Paste: `standalone-prompts/00-foundation-ci-repair.md`

### Agent 01

```powershell
git worktree add -b "agent/01-foundation-repository-inventory" "..\mplus-worktrees\01-foundation-repository-inventory" origin/main
cursor -n "..\mplus-worktrees\01-foundation-repository-inventory"
```

Paste: `standalone-prompts/01-foundation-repository-inventory.md`

## Wave 0B

### Agent 02

```powershell
git worktree add -b "agent/02-foundation-docs-canonicalization" "..\mplus-worktrees\02-foundation-docs-canonicalization" origin/main
cursor -n "..\mplus-worktrees\02-foundation-docs-canonicalization"
```

Paste: `standalone-prompts/02-foundation-docs-canonicalization.md`

## Wave 1

### Agent 03

```powershell
git worktree add -b "agent/03-refresh-lifecycle" "..\mplus-worktrees\03-refresh-lifecycle" origin/main
cursor -n "..\mplus-worktrees\03-refresh-lifecycle"
```

Paste: `standalone-prompts/03-refresh-lifecycle.md`

### Agent 04

```powershell
git worktree add -b "agent/04-admin-rbac" "..\mplus-worktrees\04-admin-rbac" origin/main
cursor -n "..\mplus-worktrees\04-admin-rbac"
```

Paste: `standalone-prompts/04-admin-rbac.md`

### Agent 05

```powershell
git worktree add -b "agent/05-cicd-hardening" "..\mplus-worktrees\05-cicd-hardening" origin/main
cursor -n "..\mplus-worktrees\05-cicd-hardening"
```

Paste: `standalone-prompts/05-cicd-hardening.md`

### Agent 06

```powershell
git worktree add -b "agent/06-utility-baseline-audit" "..\mplus-worktrees\06-utility-baseline-audit" origin/main
cursor -n "..\mplus-worktrees\06-utility-baseline-audit"
```

Paste: `standalone-prompts/06-utility-baseline-audit.md`

## Wave 2A

### Agent 07

```powershell
git worktree add -b "agent/07-utility-fallback" "..\mplus-worktrees\07-utility-fallback" origin/main
cursor -n "..\mplus-worktrees\07-utility-fallback"
```

Paste: `standalone-prompts/07-utility-fallback.md`

### Agent 09

```powershell
git worktree add -b "agent/09-bulk-character-processing" "..\mplus-worktrees\09-bulk-character-processing" origin/main
cursor -n "..\mplus-worktrees\09-bulk-character-processing"
```

Paste: `standalone-prompts/09-bulk-character-processing.md`

## Wave 2B

### Agent 10

```powershell
git worktree add -b "agent/10-calibration-harness" "..\mplus-worktrees\10-calibration-harness" origin/main
cursor -n "..\mplus-worktrees\10-calibration-harness"
```

Paste: `standalone-prompts/10-calibration-harness.md`

## Wave 2C

### Agent 08

```powershell
git worktree add -b "agent/08-admin-model-lifecycle" "..\mplus-worktrees\08-admin-model-lifecycle" origin/main
cursor -n "..\mplus-worktrees\08-admin-model-lifecycle"
```

Paste: `standalone-prompts/08-admin-model-lifecycle.md`

## Wave 3A

### Agent 11

```powershell
git worktree add -b "agent/11-scoring-calibration-study" "..\mplus-worktrees\11-scoring-calibration-study" origin/main
cursor -n "..\mplus-worktrees\11-scoring-calibration-study"
```

Paste: `standalone-prompts/11-scoring-calibration-study.md`

## Wave 3B

### Agent 12

```powershell
git worktree add -b "agent/12-repository-deep-clean" "..\mplus-worktrees\12-repository-deep-clean" origin/main
cursor -n "..\mplus-worktrees\12-repository-deep-clean"
```

Paste: `standalone-prompts/12-repository-deep-clean.md`

## Wave 4

### Agent 13

```powershell
git worktree add -b "agent/13-final-integration" "..\mplus-worktrees\13-final-integration" origin/main
cursor -n "..\mplus-worktrees\13-final-integration"
```

Paste: `standalone-prompts/13-final-integration.md`
